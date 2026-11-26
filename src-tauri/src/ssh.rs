use crate::workspace::{Document, Entry, SearchMatch, SearchOptions, WorkspaceInfo};
use russh::{
    client,
    keys::{self, HashAlg, PrivateKeyWithHashAlg},
    ChannelMsg,
};
use russh_sftp::{client::SftpSession, protocol::OpenFlags};
use serde::Deserialize;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const TIMEOUT: Duration = Duration::from_secs(25);
type Result<T> = std::result::Result<T, String>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub host: String,
    pub user: String,
    pub ssh_port: u16,
    pub password: Option<String>,
    pub identity_file: Option<PathBuf>,
    pub passphrase: Option<String>,
    pub fingerprint: Option<String>,
}

pub(crate) struct HostCheck {
    host: String,
    port: u16,
    approval: Option<String>,
    notice: Arc<Mutex<Option<String>>>,
}

impl client::Handler for HostCheck {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_key: &keys::PublicKeyOrCertificate,
    ) -> std::result::Result<bool, Self::Error> {
        let key = server_key.public_key();
        let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
        let notice = match keys::check_known_hosts(&self.host, self.port, &key) {
            Ok(true) => return Ok(true),
            Ok(false) if self.approval.as_deref() == Some(&fingerprint) => {
                match keys::known_hosts::learn_known_hosts(&self.host, self.port, &key) {
                    Ok(()) => return Ok(true),
                    Err(error) => format!("Could not remember this server: {error}"),
                }
            }
            Ok(false) => format!("SSH_HOST_KEY:{fingerprint}"),
            Err(error) => format!("SSH host key could not be verified: {error}"),
        };
        if let Ok(mut error) = self.notice.lock() {
            *error = Some(notice);
        }
        Ok(false)
    }
}

pub(crate) async fn connect(options: Credentials) -> Result<client::Handle<HostCheck>> {
    if options.host.is_empty()
        || options.host.len() > 253
        || !options
            .host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".-_:%".contains(&byte))
        || options.user.trim().is_empty()
        || options.ssh_port == 0
    {
        return Err("Enter a host, a username, and a valid SSH port.".into());
    }
    let notice = Arc::new(Mutex::new(None));
    let config = Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(15)),
        ..Default::default()
    });
    let handler = HostCheck {
        host: options.host.clone(),
        port: options.ssh_port,
        approval: options.fingerprint,
        notice: notice.clone(),
    };
    let connection = async {
        let mut session =
            client::connect(config, (options.host.as_str(), options.ssh_port), handler)
                .await
                .map_err(|error| {
                    notice
                        .lock()
                        .ok()
                        .and_then(|mut text| text.take())
                        .unwrap_or_else(|| {
                            format!("Could not connect to {}: {error}", options.host)
                        })
                })?;
        let authenticated =
            if let Some(password) = options.password.filter(|value| !value.is_empty()) {
                session
                    .authenticate_password(&options.user, password)
                    .await
                    .map_err(message)?
                    .success()
            } else {
                let hash = session
                    .best_supported_rsa_hash()
                    .await
                    .map_err(message)?
                    .flatten();
                let paths = if let Some(path) = options.identity_file {
                    vec![path]
                } else {
                    let home = std::env::home_dir().unwrap_or_default().join(".ssh");
                    ["id_ed25519", "id_ecdsa", "id_rsa"]
                        .iter()
                        .map(|name| home.join(name))
                        .filter(|path| path.is_file())
                        .collect()
                };
                let mut accepted = false;
                for path in paths {
                    let key = match keys::load_secret_key(&path, options.passphrase.as_deref()) {
                        Ok(key) => key,
                        Err(error) if options.passphrase.is_some() => {
                            return Err(format!("Could not unlock the SSH key: {error}"))
                        }
                        Err(_) => continue,
                    };
                    if session
                        .authenticate_publickey(
                            &options.user,
                            PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                        )
                        .await
                        .map_err(message)?
                        .success()
                    {
                        accepted = true;
                        break;
                    }
                }
                accepted
            };
        if !authenticated {
            return Err(
                "SSH_AUTH:Sign-in failed. Check the username, password, or private key.".into(),
            );
        }
        Ok(session)
    };
    tokio::time::timeout(TIMEOUT, connection)
        .await
        .map_err(|_| "The SSH connection timed out.".to_string())?
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(crate) struct SshWorkspace {
    pub session: client::Handle<HostCheck>,
    files: SftpSession,
    folder: String,
    label: String,
}

static WORKSPACES: Mutex<Vec<(PathBuf, Arc<SshWorkspace>)>> = Mutex::new(Vec::new());

pub(crate) fn workspace(path: &Path) -> Option<Arc<SshWorkspace>> {
    let current = WORKSPACES.lock().ok()?;
    current
        .iter()
        .find(|(root, _)| path.starts_with(root))
        .map(|(_, ssh)| Arc::clone(ssh))
}

fn join(base: &str, part: &str) -> String {
    format!("{}/{part}", base.trim_end_matches('/'))
}

fn relative(path: &str) -> Result<&str> {
    if path.is_empty()
        || path.contains(['\\', ':', '\0'])
        || path.split('/').any(|part| matches!(part, "." | ".." | ""))
    {
        return Err("Choose a path inside the SSH workspace.".into());
    }
    Ok(path)
}

pub(crate) fn release(path: &Path) {
    if let Ok(mut registry) = WORKSPACES.lock() {
        registry.retain(|(root, _)| root != path);
    }
}

#[tauri::command]
pub fn ssh_release_workspace(path: String, active: tauri::State<'_, crate::workspace::Workspace>) {
    let path = Path::new(&path);
    if crate::workspace::root(&active).ok().as_deref() != Some(path) {
        release(path);
    }
}

#[tauri::command]
pub async fn ssh_open_workspace(
    options: Credentials,
    remote_path: String,
    label: Option<String>,
) -> Result<String> {
    let label = label
        .filter(|label| !label.trim().is_empty())
        .unwrap_or_else(|| format!("{}@{}", options.user, options.host));
    let session = connect(options).await?;
    let channel = session.channel_open_session().await.map_err(message)?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(message)?;
    let files = SftpSession::new(channel.into_stream())
        .await
        .map_err(message)?;
    files.set_timeout(15);
    let path = remote_path.trim();
    let path = match path {
        "" | "~" => ".",
        other => other.strip_prefix("~/").unwrap_or(other),
    };
    let folder = files
        .canonicalize(path)
        .await
        .map_err(|error| format!("Could not open that remote folder: {error}"))?;
    if !files.metadata(&folder).await.map_err(message)?.is_dir() {
        return Err("Choose a folder on the SSH server.".into());
    }
    let key = std::env::temp_dir()
        .join("devyy-ssh")
        .join(uuid::Uuid::new_v4().to_string());
    let ssh = Arc::new(SshWorkspace {
        session,
        files,
        folder,
        label,
    });
    WORKSPACES.lock().map_err(message)?.push((key.clone(), ssh));
    Ok(crate::workspace::display_path(&key))
}

impl SshWorkspace {
    async fn checked(&self, path: &str) -> Result<String> {
        if path.is_empty() {
            return Ok(self.folder.clone());
        }
        let path = join(&self.folder, relative(path)?);
        let actual = self.files.canonicalize(&path).await.map_err(message)?;
        if actual != self.folder && !actual.starts_with(&join(&self.folder, "")) {
            return Err("This path points outside the SSH workspace.".into());
        }
        Ok(path)
    }

    async fn destination(&self, path: &str) -> Result<String> {
        let path = relative(path)?;
        let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
        Ok(join(&self.checked(parent).await?, name))
    }

    pub async fn directory(&self, path: &str) -> Result<Vec<Entry>> {
        let mut entries = Vec::new();
        for item in self
            .files
            .read_dir(self.checked(path).await?)
            .await
            .map_err(message)?
        {
            let name = item.file_name();
            if relative(&name).is_err() || name == ".git" {
                continue;
            }
            entries.push(Entry {
                path: if path.is_empty() {
                    name.clone()
                } else {
                    join(path, &name)
                },
                name,
                directory: item.file_type().is_dir(),
            });
        }
        entries.sort_by_cached_key(|item| (!item.directory, item.name.to_lowercase()));
        Ok(entries)
    }

    pub async fn entries(&self, depth: usize, limit: usize) -> Result<Vec<Entry>> {
        self.entries_at("", depth, limit).await
    }

    pub async fn entries_at(&self, path: &str, depth: usize, limit: usize) -> Result<Vec<Entry>> {
        let mut queue = std::collections::VecDeque::from([(path.to_owned(), depth)]);
        let mut entries = Vec::new();
        while let Some((path, depth)) = queue.pop_front() {
            for row in self.directory(&path).await? {
                if depth > 1
                    && row.directory
                    && !matches!(
                        row.name.as_str(),
                        "node_modules" | "target" | ".next" | "dist" | ".venv" | "vendor" | "build"
                    )
                {
                    queue.push_back((row.path.clone(), depth - 1));
                }
                entries.push(row);
                if entries.len() >= limit {
                    return Ok(entries);
                }
            }
        }
        Ok(entries)
    }

    pub async fn info(&self, path: &Path, depth: usize, limit: usize) -> Result<WorkspaceInfo> {
        Ok(WorkspaceInfo {
            root: crate::workspace::display_path(path),
            name: self.label.clone(),
            files: self.entries(depth, limit).await?,
            logo: None,
            remote_path: Some(self.folder.clone()),
        })
    }

    async fn read_at(&self, path: &str, max: u64) -> Result<Vec<u8>> {
        let mut data = Vec::new();
        let mut file = self.files.open(path).await.map_err(message)?;
        (&mut file)
            .take(max + 1)
            .read_to_end(&mut data)
            .await
            .map_err(message)?;
        file.shutdown().await.map_err(message)?;
        if data.len() as u64 > max {
            return Err("This file exceeds the preview or editing limit.".into());
        }
        Ok(data)
    }

    pub async fn bytes(&self, path: &str, max: u64) -> Result<Vec<u8>> {
        self.read_at(&self.checked(path).await?, max).await
    }

    fn stamp(data: &[u8]) -> String {
        format!(
            "{:x?}",
            ring::digest::digest(&ring::digest::SHA256, data).as_ref()
        )
    }

    pub async fn read(&self, path: &str) -> Result<Document> {
        let data = self.bytes(path, 5_000_000).await?;
        let modified = Self::stamp(&data);
        let content =
            String::from_utf8(data).map_err(|_| "This file is not UTF-8 text.".to_string())?;
        if content.contains('\0') {
            return Err("Binary files cannot be opened in the text editor.".into());
        }
        Ok(Document { content, modified })
    }

    pub async fn write(&self, path: &str, content: &str, expected: &str) -> Result<String> {
        let new = expected == "devyy:new";
        let path = if new {
            self.destination(path).await?
        } else {
            self.checked(path).await?
        };
        if !new && Self::stamp(&self.read_at(&path, 5_000_000).await?) != expected {
            return Err("The file changed on the server. Reopen it before saving.".into());
        }
        let flags = if new {
            OpenFlags::CREATE | OpenFlags::EXCLUDE
        } else {
            OpenFlags::TRUNCATE
        };
        let mut file = self
            .files
            .open_with_flags(path, OpenFlags::WRITE | flags)
            .await
            .map_err(message)?;
        file.write_all(content.as_bytes()).await.map_err(message)?;
        file.shutdown().await.map_err(message)?;
        Ok(Self::stamp(content.as_bytes()))
    }

    pub async fn create(&self, path: &str, directory: bool) -> Result<()> {
        let path = relative(path)?;
        let mut prefix = String::new();
        if let Some((parent, _)) = path.rsplit_once('/') {
            for segment in parent.split('/') {
                if !prefix.is_empty() {
                    prefix.push('/');
                }
                prefix.push_str(segment);
                let destination = self.destination(&prefix).await?;
                if let Err(error) = self.files.create_dir(&destination).await {
                    match self.checked(&prefix).await {
                        Ok(checked)
                            if self
                                .files
                                .metadata(&checked)
                                .await
                                .is_ok_and(|m| m.is_dir()) => {}
                        _ => return Err(message(error)),
                    }
                }
            }
        }
        if directory {
            self.files
                .create_dir(self.destination(path).await?)
                .await
                .map_err(message)
        } else {
            self.write(path, "", "devyy:new").await.map(|_| ())
        }
    }

    pub async fn rename(&self, path: &str, new_path: &str) -> Result<()> {
        let from = self.destination(path).await?;
        let to = self.destination(new_path).await?;
        if self.files.symlink_metadata(&to).await.is_ok() {
            return Err("A file already exists at that path.".into());
        }
        self.files.rename(from, to).await.map_err(message)
    }

    pub async fn delete(&self, path: &str) -> Result<()> {
        let path = self.destination(path).await?;
        let mut pending = vec![(path, false)];
        while let Some((path, visited)) = pending.pop() {
            if !self
                .files
                .symlink_metadata(&path)
                .await
                .map_err(message)?
                .is_dir()
            {
                self.files.remove_file(path).await.map_err(message)?;
            } else if visited {
                self.files.remove_dir(path).await.map_err(message)?;
            } else {
                let children = self.files.read_dir(&path).await.map_err(message)?;
                pending.push((path, true));
                for child in children {
                    relative(&child.file_name())?;
                    pending.push((child.path(), false));
                }
            }
        }
        Ok(())
    }

    pub async fn search(&self, options: SearchOptions) -> Result<Vec<SearchMatch>> {
        if options.query.is_empty() {
            return Ok(Vec::new());
        }
        let needle = if options.case_sensitive {
            options.query
        } else {
            options.query.to_lowercase()
        };
        let mut matches = Vec::new();
        for file in self
            .entries(20, 30_000)
            .await?
            .into_iter()
            .filter(|entry| !entry.directory)
        {
            let Ok(bytes) = self.bytes(&file.path, 1_000_000).await else {
                continue;
            };
            let Ok(text) = String::from_utf8(bytes) else {
                continue;
            };
            if text.contains('\0') {
                continue;
            }
            for (line, text) in text.lines().enumerate() {
                let lower;
                let hay = if options.case_sensitive {
                    text
                } else {
                    lower = text.to_lowercase();
                    &lower
                };
                if let Some(column) = hay.find(&needle) {
                    matches.push(SearchMatch {
                        path: file.path.clone(),
                        line: line + 1,
                        text: text.chars().take(500).collect(),
                        column,
                    });
                    if matches.len() == 500 {
                        return Ok(matches);
                    }
                }
            }
        }
        Ok(matches)
    }

    pub async fn ensure_parent(&self, path: &str) -> Result<()> {
        let path = relative(path)?;
        let Some((parent, _)) = path.rsplit_once('/') else {
            return Ok(());
        };
        let mut prefix = String::new();
        for dir in parent.split('/') {
            prefix = if prefix.is_empty() {
                dir.to_owned()
            } else {
                join(&prefix, dir)
            };
            if !self.exists(&prefix).await? {
                self.create(&prefix, true).await?;
            }
        }
        Ok(())
    }

    pub async fn exists(&self, path: &str) -> Result<bool> {
        self.files
            .try_exists(self.destination(path).await?)
            .await
            .map_err(message)
    }

    pub fn relative_to(&self, path: &Path) -> String {
        let registry = WORKSPACES.lock().unwrap_or_else(|error| error.into_inner());
        registry
            .iter()
            .find_map(|(root, _)| path.strip_prefix(root).ok())
            .map(|relative| relative.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default()
    }

    pub fn run_blocking(&self, script: &str) -> Result<std::process::Output> {
        let (code, stdout, stderr) = tauri::async_runtime::block_on(self.run("", script))?;
        #[cfg(unix)]
        use std::os::unix::process::ExitStatusExt;
        #[cfg(windows)]
        use std::os::windows::process::ExitStatusExt;
        #[cfg(unix)]
        let code = (code as i32) << 8;
        Ok(std::process::Output {
            status: std::process::ExitStatus::from_raw(code),
            stdout,
            stderr,
        })
    }

    pub fn shell_command(&self, cwd: &str, command: &str) -> String {
        let path = if cwd.is_empty() {
            self.folder.clone()
        } else {
            join(&self.folder, cwd)
        };
        format!("cd {} && {command}", quote(&path))
    }

    pub async fn run(&self, cwd: &str, script: &str) -> Result<(u32, Vec<u8>, Vec<u8>)> {
        if !cwd.is_empty() {
            self.checked(cwd).await?;
        }
        let mut channel = self.session.channel_open_session().await.map_err(message)?;
        channel
            .exec(true, self.shell_command(cwd, script))
            .await
            .map_err(message)?;
        channel.eof().await.map_err(message)?;
        let result = tokio::time::timeout(Duration::from_secs(30), async {
            let (mut exit, mut stdout, mut stderr) = (None, Vec::new(), Vec::new());
            while let Some(msg) = channel.wait().await {
                match msg {
                    ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                    ChannelMsg::ExtendedData { data, .. } => stderr.extend_from_slice(&data),
                    ChannelMsg::ExitStatus { exit_status } => exit = Some(exit_status),
                    _ => {}
                }
                if stdout.len() + stderr.len() > 16 * 1024 * 1024 {
                    return Err("Remote command output exceeded 16 MiB.".into());
                }
            }
            Ok((
                exit.ok_or("The SSH command did not return an exit status.")?,
                stdout,
                stderr,
            ))
        })
        .await;
        let _ = channel.close().await;
        result.map_err(|_| "The SSH command timed out after 30 seconds.".to_string())?
    }
}

pub fn quote(value: &str) -> String {
    format!("'{}'", value.replace(char::from(39), "'\\''"))
}
