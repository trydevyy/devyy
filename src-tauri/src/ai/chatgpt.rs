//! Devyy's own public-client ChatGPT connection. Does not read Codex credentials.
use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use ring::{aead, digest, rand::{SecureRandom, SystemRandom}};
use std::{io::Write, path::Path, time::{SystemTime, UNIX_EPOCH}};
use tokio::{io::AsyncReadExt, net::TcpListener};

const ISSUER: &str = "https://auth.openai.com";
const AUTHORIZE: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";
const RESOURCE: &str = "https://api.openai.com/v1";
const SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
const BOOTSTRAP: &str = "dynamic_agent_client";
const VAULT_AAD: &[u8] = b"devyy-chatgpt-accounts-v1";
const VAULT_KEY: &str = "chatgpt-vault-key-v1";
const MAX_JSON: usize = 2 * 1024 * 1024;

#[derive(Serialize, Deserialize, Default)]
struct Vault {
    host_id: String,
    active: Option<String>,
    accounts: Vec<Registration>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Registration {
    client_id: String,
    subject: String,
    email: Option<String>,
    session: Option<Session>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Session {
    access_token: String,
    refresh_token: String,
    id_token: String,
    scopes: Vec<String>,
    expires_at: u64,
    #[serde(default)]
    earliest_refresh_at: u64,
}
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    #[serde(default)]
    id_token: Option<String>,
    token_type: String,
    expires_in: u64,
    scope: Option<String>,
    #[serde(default)]
    earliest_refresh_at: Option<u64>,
}
#[derive(Deserialize)]
struct Claims {
    sub: String,
    email: Option<String>,
    nonce: Option<String>,
}
#[derive(Deserialize)]
struct Discovery {
    issuer: String,
    jwks_uri: String,
    revocation_endpoint: String,
}
fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}
fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut bytes = [0; N];
    SystemRandom::new().fill(&mut bytes).map_err(|_| "Could not generate secure sign-in values")?;
    Ok(bytes)
}
fn secret() -> Result<String, String> { Ok(URL_SAFE_NO_PAD.encode(random::<32>()?)) }
fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid credential path")?;
    std::fs::create_dir_all(parent).map_err(|_| "Could not create credential directory")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|_| "Could not create credential file")?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        file.as_file().set_permissions(std::fs::Permissions::from_mode(0o600)).map_err(|_| "Could not protect credential file")?;
    }
    file.write_all(data).and_then(|_|file.as_file().sync_all()).map_err(|_| "Could not write credentials")?;
    file.persist(path).map_err(|_| "Could not replace credential file")?;
    Ok(())
}
fn vault_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_path(app)?.with_file_name("chatgpt-accounts.enc"))
}
fn vault_key(create: bool) -> Result<aead::LessSafeKey, String> {
    let encoded = match get_key(VAULT_KEY)? {
        Some(key) => key,
        None if create => {
            let key = secret()?;
            credential(VAULT_KEY)?.set_password(&key).map_err(|_| "Unlock the system credential store to connect ChatGPT")?;
            key
        }
        None => return Err("ChatGPT credential encryption key is missing. Restore your system credential store before reconnecting.".into()),
    };
    let bytes = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| "Invalid ChatGPT credential encryption key")?;
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, &bytes).map_err(|_| "Invalid ChatGPT credential encryption key")?;
    Ok(aead::LessSafeKey::new(key))
}
fn seal(vault: &Vault, key: &aead::LessSafeKey) -> Result<Vec<u8>, String> {
    let nonce = random::<12>()?;
    let mut data = serde_json::to_vec(vault).map_err(|_| "Could not encode ChatGPT credentials")?;
    key.seal_in_place_append_tag(aead::Nonce::assume_unique_for_key(nonce), aead::Aad::from(VAULT_AAD), &mut data).map_err(|_| "Could not encrypt ChatGPT credentials")?;
    let mut file = nonce.to_vec(); file.extend(data); Ok(file)
}
fn unseal(mut bytes: Vec<u8>, key: &aead::LessSafeKey) -> Result<Vault, String> {
    if bytes.len() < 28 || bytes.len() > MAX_JSON { return Err("Invalid ChatGPT credential file".into()); }
    let nonce: [u8; 12] = bytes[..12].try_into().unwrap();
    let data = key.open_in_place(aead::Nonce::assume_unique_for_key(nonce), aead::Aad::from(VAULT_AAD), &mut bytes[12..]).map_err(|_| "Could not decrypt ChatGPT credentials. Check your system credential store.")?;
    serde_json::from_slice(data).map_err(|_| "Invalid ChatGPT credential record".into())
}
fn load_vault(app: &AppHandle) -> Result<Vault, String> {
    let path = vault_path(app)?;
    if !path.exists() { return Ok(Vault::default()); }
    if std::fs::metadata(&path).map_err(|_| "Could not inspect ChatGPT credentials")?.len() > MAX_JSON as u64 { return Err("ChatGPT credential file is too large".into()); }
    unseal(std::fs::read(path).map_err(|_| "Could not read ChatGPT credentials")?, &vault_key(false)?)
}
fn save_vault(app: &AppHandle, vault: &Vault) -> Result<(), String> {
    atomic_write(&vault_path(app)?, &seal(vault, &vault_key(true)?)?)
}
async fn read_json(mut response: reqwest::Response) -> Result<Value, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "The account connection was interrupted")? {
        if bytes.len() + chunk.len() > MAX_JSON { return Err("Account response exceeded the size limit".into()); }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "The provider returned an invalid account response".into())
}
fn auth_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid OpenAI authorization endpoint")?;
    if url.scheme() != "https" || url.host_str() != Some("auth.openai.com") || url.port_or_known_default() != Some(443) || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() || url.query().is_some() { return Err("Untrusted OpenAI authorization endpoint".into()); }
    Ok(url)
}
async fn discovery() -> Result<Discovery, String> {
    let response = client()?.get(format!("{ISSUER}/.well-known/openid-configuration")).send().await.map_err(|_| "Could not reach OpenAI account discovery")?;
    if !response.status().is_success() { return Err("OpenAI account discovery is unavailable".into()); }
    let config: Discovery = serde_json::from_value(read_json(response).await?).map_err(|_| "Invalid OpenAI account discovery")?;
    if config.issuer != ISSUER { return Err("Unexpected OpenAI token issuer".into()); }
    auth_url(&config.jwks_uri)?; auth_url(&config.revocation_endpoint)?;
    Ok(config)
}
fn verify_id_token(token: &str, client_id: &str, nonce: Option<&str>, subject: Option<&str>, keys: &JwkSet) -> Result<Claims, String> {
    let header = decode_header(token).map_err(|_| "Invalid OpenAI identity token")?;
    if header.alg != Algorithm::RS256 { return Err("Unsupported OpenAI identity signature".into()); }
    let kid = header.kid.ok_or("OpenAI identity token has no signing key")?;
    let jwk = keys.find(&kid).ok_or("OpenAI identity signing key was not found")?;
    let key = DecodingKey::from_jwk(jwk).map_err(|_| "Invalid OpenAI identity signing key")?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[client_id]); validation.set_issuer(&[ISSUER]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.validate_nbf = true; validation.leeway = 30;
    let claims = decode::<Claims>(token, &key, &validation).map_err(|_| "OpenAI identity verification failed. Try signing in again.")?.claims;
    if claims.sub.is_empty() || nonce.is_some_and(|n| claims.nonce.as_deref() != Some(n)) || subject.is_some_and(|s| claims.sub != s) { return Err("OpenAI returned a different account or an invalid sign-in nonce".into()); }
    Ok(claims)
}
async fn identity(token: &str, client_id: &str, nonce: Option<&str>, subject: Option<&str>) -> Result<Claims, String> {
    let config = discovery().await?;
    let response = client()?.get(auth_url(&config.jwks_uri)?).send().await.map_err(|_| "Could not retrieve OpenAI identity signing keys")?;
    if !response.status().is_success() { return Err("OpenAI identity signing keys are unavailable".into()); }
    let keys: JwkSet = serde_json::from_value(read_json(response).await?).map_err(|_| "Invalid OpenAI signing keys")?;
    verify_id_token(token, client_id, nonce, subject, &keys)
}
fn session(tokens: TokenResponse, previous: Option<&Session>) -> Result<Session, String> {
    if !tokens.token_type.eq_ignore_ascii_case("bearer") || tokens.access_token.is_empty() || tokens.refresh_token.is_empty() || tokens.expires_in == 0 || tokens.expires_in > 86400 { return Err("OpenAI returned an incomplete token set".into()); }
    let id_token = tokens.id_token.or_else(||previous.map(|s|s.id_token.clone())).ok_or("OpenAI returned no identity token")?;
    let scopes = tokens.scope.map(|s|s.split_whitespace().map(str::to_owned).collect()).or_else(||previous.map(|s|s.scopes.clone())).ok_or("OpenAI returned no granted scopes")?;
    Ok(Session { access_token: tokens.access_token, refresh_token: tokens.refresh_token, id_token, scopes, expires_at: now() + tokens.expires_in, earliest_refresh_at: tokens.earliest_refresh_at.unwrap_or(0) })
}
struct Attempt { state: String, nonce: String, verifier: String, redirect: String, client_id: String }
impl Attempt {
    fn url(&self, host: &str, previous: Option<&Registration>) -> String {
        let mut url = reqwest::Url::parse(AUTHORIZE).unwrap();
        { let mut q = url.query_pairs_mut();
            q.extend_pairs([("client_id", self.client_id.as_str()), ("response_type", "code"), ("redirect_uri", &self.redirect), ("scope", SCOPE), ("resource", RESOURCE), ("state", &self.state), ("nonce", &self.nonce), ("code_challenge_method", "S256"), ("code_challenge", &URL_SAFE_NO_PAD.encode(digest::digest(&digest::SHA256, self.verifier.as_bytes()))), ("ext_agent_host_id", host)]);
            if self.client_id == BOOTSTRAP { q.append_pair("agent_name_hint", "Devyy"); }
            if let Some(registration) = previous {
                if let Some(session) = &registration.session { q.append_pair("id_token_hint", &session.id_token); }
                if let Some(email) = &registration.email { q.append_pair("login_hint", email); }
            }
        }
        url.into()
    }
    fn callback(&self, target: &str) -> Result<(String, String), String> {
        let url = reqwest::Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| "Invalid authorization callback")?;
        if url.path() != "/auth/callback" { return Err("Invalid callback path".into()); }
        let mut q = HashMap::new();
        for (k,v) in url.query_pairs() { if q.insert(k.into_owned(), v.into_owned()).is_some() { return Err("Duplicate authorization callback parameter".into()); } }
        if q.get("state") != Some(&self.state) { return Err("Authorization state did not match".into()); }
        if let Some(error) = q.get("error") { return Err(if error == "access_denied" { "ChatGPT authorization was declined" } else { "ChatGPT authorization failed" }.into()); }
        let client_id = q.get("client_id").cloned().unwrap_or_else(||self.client_id.clone());
        if client_id == BOOTSTRAP || client_id.is_empty() || client_id.len() > 200 || !client_id.bytes().all(|c|c.is_ascii_alphanumeric() || c == b'_' || c == b'-') || (self.client_id != BOOTSTRAP && client_id != self.client_id) { return Err("ChatGPT registration returned a missing or different client ID".into()); }
        let code = q.get("code").filter(|s| !s.is_empty()).ok_or("ChatGPT returned no authorization code")?.clone();
        Ok((code, client_id))
    }
}
async fn callback(listener: &TcpListener, attempt: &Attempt) -> Result<(String, String), String> {
    loop {
        let (mut socket, _) = listener.accept().await.map_err(|_| "Could not receive the browser callback")?;
        let mut bytes = Vec::new();
        let read = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let mut chunk = [0; 2048]; let n = socket.read(&mut chunk).await?;
                if n == 0 { break; } bytes.extend_from_slice(&chunk[..n]);
                if bytes.len() > 16384 || bytes.windows(4).any(|b| b == b"\r\n\r\n") { break; }
            } Ok::<(), std::io::Error>(())
        }).await;
        if !matches!(read, Ok(Ok(()))) { continue; }
        let request = String::from_utf8_lossy(&bytes);
        let mut line = request.lines().next().unwrap_or("").split_whitespace();
        let method = line.next().unwrap_or(""); let target = line.next().unwrap_or("");
        let host = request.lines().skip(1).find_map(|l|l.split_once(':').filter(|(k,_)|k.eq_ignore_ascii_case("host")).map(|(_,v)|v.trim()));
        let expected_host = attempt.redirect.strip_prefix("http://").unwrap().split('/').next().unwrap();
        let valid = method == "GET" && bytes.len() <= 16384 && host == Some(expected_host) && target.starts_with("/auth/callback?");
        let result = if valid { attempt.callback(target) } else { Err("Invalid callback request".into()) };
        // Ignore unrelated requests and invalid state without consuming the pending sign-in.
        let state_matches = valid && reqwest::Url::parse(&format!("http://127.0.0.1{target}")).ok().is_some_and(|u|u.query_pairs().filter(|(k,_)|k == "state").collect::<Vec<_>>() == vec![("state".into(),attempt.state.as_str().into())]);
        let body = if result.is_ok() { "Authorization received. Return to Devyy to finish connecting." } else { "Authorization could not be completed. Return to Devyy." };
        let status = if result.is_ok() { "200 OK" } else { "400 Bad Request" };
        let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        let _ = tokio::time::timeout(Duration::from_secs(2), socket.write_all(response.as_bytes())).await;
        if state_matches { return result; }
    }
}
fn status(vault: &Vault) -> Value {
    let selected = vault.accounts.iter().find(|a|Some(&a.client_id) == vault.active.as_ref());
    let account = selected.filter(|a|a.session.is_some()).map(|a|json!({"type":"chatgpt","email":a.email,"clientId":a.client_id}));
    json!({"account":account,"limits":null,"planEnabled":selected.and_then(|a|a.session.as_ref()).is_some_and(|s|s.scopes.iter().any(|s|s==PLAN_SCOPE)),"accounts":vault.accounts.iter().map(|a|json!({"id":a.client_id,"email":a.email,"connected":a.session.is_some(),"active":Some(&a.client_id)==vault.active.as_ref()})).collect::<Vec<_>>()})
}
pub(super) async fn account(app: &AppHandle, state: &AiState, action: &str, request_id: &str, account_id: Option<&str>) -> Result<Value, String> {
    if ["login", "add"].contains(&action) {
        let _login = state.oauth_login.try_lock().map_err(|_| "A ChatGPT sign-in is already in progress")?;
        let (host, previous) = {
            let _lock = state.oauth.lock().await;
            let mut vault = load_vault(app)?;
            if vault.host_id.is_empty() { vault.host_id = format!("urn:uuid:{}", uuid::Uuid::new_v4()); save_vault(app, &vault)?; }
            if action == "add" && vault.accounts.len() >= 16 { return Err("Up to 16 ChatGPT registrations can be saved".into()); }
            let selected = if action == "add" { None } else { account_id.or(vault.active.as_deref()) };
            let previous = selected.map(|id|vault.accounts.iter().find(|a|a.client_id==id).cloned().ok_or("ChatGPT account was not found")).transpose()?;
            (vault.host_id, previous)
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|_| "Could not start Devyy's local sign-in callback")?;
        let attempt = Attempt { state: secret()?, nonce: secret()?, verifier: secret()?, redirect:format!("http://127.0.0.1:{}/auth/callback",listener.local_addr().map_err(|_|"Could not inspect sign-in callback")?.port()), client_id:previous.as_ref().map(|a|a.client_id.clone()).unwrap_or_else(||BOOTSTRAP.into()) };
        emit(app, request_id, "login", json!({"authUrl":attempt.url(&host, previous.as_ref())}));
        let (code, client_id) = callback(&listener, &attempt).await?;
        let response = client()?.post(TOKEN).form(&[("grant_type","authorization_code"),("client_id",&client_id),("code",&code),("code_verifier",&attempt.verifier),("redirect_uri",&attempt.redirect),("resource",RESOURCE)]).send().await.map_err(|_| "Could not complete ChatGPT authorization. Start a new sign-in.")?;
        if !response.status().is_success() { return Err("ChatGPT could not exchange the authorization code. Start a new sign-in.".into()); }
        let tokens: TokenResponse = serde_json::from_value(read_json(response).await?).map_err(|_| "Invalid ChatGPT token response")?;
        let claims = identity(tokens.id_token.as_deref().ok_or("ChatGPT returned no identity token")?, &client_id, Some(&attempt.nonce), previous.as_ref().map(|a|a.subject.as_str())).await?;
        let registration = Registration { client_id:client_id.clone(), subject:claims.sub, email:claims.email, session:Some(session(tokens,None)?) };
        let _lock = state.oauth.lock().await;
        let mut vault = load_vault(app)?;
        if let Some(old) = vault.accounts.iter_mut().find(|a|a.client_id==client_id) {
            if old.subject != registration.subject { return Err("This ChatGPT registration belongs to another account".into()); } *old = registration;
        } else { vault.accounts.push(registration); }
        vault.active = Some(client_id); save_vault(app,&vault)?; return Ok(status(&vault));
    }
    let _lock = state.oauth.lock().await;
    let mut vault = load_vault(app)?;
    match action {
        "status" => {},
        "select" => {
            let id = account_id.ok_or("Choose a saved ChatGPT account")?;
            if !vault.accounts.iter().any(|a|a.client_id==id && a.session.is_some()) { return Err("Sign in to this saved account first".into()); }
            vault.active = Some(id.into()); save_vault(app,&vault)?;
        },
        "logout" => {
            let mut revoked = true;
            if let Some(a) = vault.accounts.iter_mut().find(|a|Some(&a.client_id)==vault.active.as_ref()) {
                if let Some(session) = a.session.take() {
                    revoked = revoke(&a.client_id,&session.refresh_token).await;
                }
            }
            // Retain the account/client mapping for reauthorization; never sign out of Codex.
            save_vault(app,&vault)?;
            let mut result = status(&vault);
            if !revoked { result["notice"] = json!("Signed out locally. Remote revocation was not confirmed; disconnect Devyy in ChatGPT Settings to end the remote session."); }
            return Ok(result);
        },
        _ => return Err("Unknown ChatGPT account action".into()),
    }
    Ok(status(&vault))
}
async fn revoke(client_id: &str, token: &str) -> bool {
    let Ok(config) = discovery().await else { return false; };
    for attempt in 0..2 {
        let response = match client() { Ok(c) => c.post(&config.revocation_endpoint).timeout(Duration::from_secs(15)).form(&[("token",token),("token_type_hint","refresh_token"),("client_id",client_id)]).send().await, Err(_) => return false };
        match response { Ok(r) if r.status().as_u16()==200 => return true, Ok(r) if !r.status().is_server_error() => return false, _=>{} }
        if attempt == 0 { tokio::time::sleep(Duration::from_millis(300)).await; }
    } false
}
async fn access(app: &AppHandle, state: &AiState) -> Result<String, String> {
    let _lock = state.oauth.lock().await;
    let mut vault = load_vault(app)?;
    let a = vault.accounts.iter_mut().find(|a|Some(&a.client_id)==vault.active.as_ref()).ok_or("Connect your ChatGPT account in Settings → AI providers")?;
    let saved = a.session.as_ref().ok_or("Sign in to ChatGPT again in AI providers")?;
    if !saved.scopes.iter().any(|s|s==PLAN_SCOPE) { return Err("ChatGPT plan access was not granted. Sign in again and enable plan use on the Devyy authorization screen.".into()); }
    if saved.expires_at > now()+60 { return Ok(saved.access_token.clone()); }
    if now() < saved.earliest_refresh_at {
        if saved.expires_at > now() { return Ok(saved.access_token.clone()); }
        return Err("ChatGPT has asked Devyy to wait before refreshing. Try again shortly.".into());
    }
    let response = client()?.post(TOKEN).form(&[("grant_type","refresh_token"),("client_id",&a.client_id),("refresh_token",&saved.refresh_token),("resource",RESOURCE)]).send().await.map_err(|_| "Could not refresh ChatGPT access. Try again when connected.")?;
    let code = response.status(); let value = read_json(response).await?;
    if !code.is_success() {
        let error = value["error"].as_str().or_else(||value.pointer("/error/code").and_then(Value::as_str)).unwrap_or("");
        if ["invalid_grant","invalid_refresh_token","token_expired","refresh_token_expired","refresh_token_invalidated","refresh_token_reused"].contains(&error) {
            a.session=None; save_vault(app,&vault)?; return Err("ChatGPT access has expired or was revoked. Sign in again in AI providers.".into());
        }
        return Err("ChatGPT access could not be refreshed. Your connection was preserved; try again later.".into());
    }
    let tokens: TokenResponse = serde_json::from_value(value).map_err(|_| "Invalid ChatGPT refresh response")?;
    if let Some(id_token) = &tokens.id_token { identity(id_token,&a.client_id,None,Some(&a.subject)).await?; }
    let next = session(tokens,Some(saved))?;
    let token = next.access_token.clone(); a.session=Some(next); save_vault(app,&vault)?; Ok(token)
}
fn api_error(value: &Value, status: u16) -> String {
    let code = value.pointer("/error/code").or_else(||value.pointer("/response/error/code")).and_then(Value::as_str).unwrap_or("");
    match code {
        "subscription_sharing_user_not_eligible" => "ChatGPT plan access is unavailable for this account or workspace. Check its plan and workspace policy.",
        "subscription_sharing_usage_limit_exceeded" => "Devyy has reached its ChatGPT usage limit. Review app limits at chatgpt.com/settings/usage.",
        "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable" => "ChatGPT usage is temporarily unavailable. Your connection was preserved; try again later.",
        "subscription_sharing_unsupported_capability" => "ChatGPT does not support this model or request option for connected apps. Choose another model or reasoning setting.",
        "subscription_sharing_route_not_supported" | "chatpass_v2_scope_not_authorized" | "chatpass_v2_invalid_authorization_context" => "The ChatGPT grant does not authorize this operation. Review Devyy's app permissions in ChatGPT Settings.",
        "subscription_sharing_invalid_user" => "ChatGPT could not validate this account. Reconnect it in AI providers.",
        _ if status == 401 => "ChatGPT rejected this connection. Sign in again in AI providers.",
        _ => return format!("ChatGPT returned HTTP {status}. Check the selected model and app permissions."),
    }.into()
}
pub(super) async fn models(app: &AppHandle, state: &AiState) -> Result<Vec<Value>, String> {
    let token=access(app,state).await?;
    let response=client()?.get(format!("{RESOURCE}/models")).bearer_auth(token).send().await.map_err(|_|"Could not load ChatGPT models")?;
    let code=response.status(); let value=read_json(response).await?;
    if !code.is_success() { return Err(api_error(&value,code.as_u16())); }
    model_catalog(&value)
}
fn model_catalog(value: &Value) -> Result<Vec<Value>,String> {
    Ok(value["models"].as_array().ok_or("ChatGPT returned no model catalog")?.iter().filter(|m|m["visibility"]=="list").filter_map(|m|m["slug"].as_str().map(|id|json!({"id":id,"name":m["display_name"].as_str().unwrap_or(id),"description":m["description"],"reasoningEfforts":m["supported_reasoning_levels"].as_array().map(|a|a.iter().filter_map(|v|v["effort"].as_str()).collect::<Vec<_>>()).unwrap_or_default()}))).collect())
}
fn body(p: &Provider, r: &ChatRequest) -> Value {
    let mut body=json!({"model":p.model,"instructions":SYSTEM,"input":r.messages,"store":false,"stream":true});
    if let Some(effort)=r.effort.as_ref().filter(|s|!s.is_empty()) { body["reasoning"]=json!({"effort":effort}); } body
}
pub(super) async fn chat(app: &AppHandle, state: &AiState, p: &Provider, r: &ChatRequest) -> Result<(), String> {
    if p.model.trim().is_empty() { return Err("Choose a ChatGPT model in the model picker first".into()); }
    let token=access(app,state).await?;
    let response=client()?.post(format!("{RESOURCE}/responses")).bearer_auth(token).json(&body(p,r)).send().await.map_err(|_|"Could not reach ChatGPT")?;
    consume(app,r,response).await
}
async fn consume<R: tauri::Runtime>(app: &AppHandle<R>, r: &ChatRequest, mut response: reqwest::Response) -> Result<(), String> {
    if !response.status().is_success() { let code=response.status().as_u16(); return Err(api_error(&read_json(response).await?,code)); }
    let mut sse=Sse::default(); let mut total=0;
    while let Some(chunk)=response.chunk().await.map_err(|_|"ChatGPT connection ended unexpectedly")? {
        for data in sse.push(&chunk)? {
            if data=="[DONE]" { continue; }
            let event: Value=serde_json::from_str(&data).map_err(|_|"Invalid ChatGPT stream event")?;
            match event["type"].as_str().unwrap_or("") {
                "response.failed" | "error" => return Err(api_error(&event,400)),
                "response.incomplete" => return Err("ChatGPT stopped before completing the reply. Try a smaller request.".into()),
                "response.output_text.delta" => {
                    if let Some(text)=event["delta"].as_str() {
                        total+=text.len(); if total>4*1024*1024 { return Err("ChatGPT reply exceeded the size limit".into()); }
                        emit(app,&r.request_id,"delta",json!(text));
                    }
                },
                "response.completed" => {
                    if event.pointer("/response/status").is_some_and(|s|s!="completed") { return Err("ChatGPT did not complete the reply".into()); }
                    if let Some(usage)=event.pointer("/response/usage") { emit(app,&r.request_id,"usage",usage.clone()); }
                    return Ok(());
                }, _=>{},
            }
        }
    } Err("ChatGPT connection closed before response.completed. You can retry the message.".into())
}
