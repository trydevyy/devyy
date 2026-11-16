// Copyright (C) 2026 Devyy contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

use base64::{engine::general_purpose::STANDARD, Engine};
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use std::{collections::BTreeMap, io::Write, sync::Mutex};
use tauri::{AppHandle, Manager};
#[derive(Default)]
pub struct ExtensionSecrets(Mutex<()>);
const MAX: usize = 2 * 1024 * 1024;
fn cipher(id: &str, create: bool) -> Result<aead::LessSafeKey, String> {
    let entry = keyring::Entry::new("xyz.devyy.editor.extension-secrets", id)
        .map_err(|_| "Could not access extension credential store")?;
    let encoded = match entry.get_password() {
        Ok(key) => key,
        Err(keyring::Error::NoEntry) if create => {
            let mut key = [0; 32];
            SystemRandom::new()
                .fill(&mut key)
                .map_err(|_| "Secure random generator unavailable")?;
            let encoded = STANDARD.encode(key);
            entry
                .set_password(&encoded)
                .map_err(|_| "Unlock your system credential store to save extension secrets")?;
            encoded
        }
        Err(keyring::Error::NoEntry) => {
            return Err("Extension credential encryption key is missing".into())
        }
        Err(_) => {
            return Err("Unlock your system credential store to read extension secrets".into())
        }
    };
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid extension credential encryption key")?;
    Ok(aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, &bytes)
            .map_err(|_| "Invalid extension credential encryption key")?,
    ))
}
fn encrypt(id: &str, key: &aead::LessSafeKey, mut bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let mut nonce = [0; 12];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "Secure random generator unavailable")?;
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(id.as_bytes()),
        &mut bytes,
    )
    .map_err(|_| "Could not encrypt extension secrets")?;
    let mut output = nonce.to_vec();
    output.extend(bytes);
    Ok(output)
}
fn decrypt(id: &str, key: &aead::LessSafeKey, mut bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    if bytes.len() < 28 || bytes.len() > MAX {
        return Err("Invalid extension credential vault".into());
    }
    let nonce = bytes[..12].try_into().unwrap();
    key.open_in_place(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(id.as_bytes()),
        &mut bytes[12..],
    )
    .map(|b| b.to_vec())
    .map_err(|_| "Could not decrypt extension secrets; the saved vault was preserved".into())
}
#[tauri::command]
pub async fn extension_secret(
    app: AppHandle,
    id: String,
    key: String,
    action: String,
    value: Option<String>,
) -> Result<Option<String>, String> {
    if key.is_empty()
        || key.len() > 1024
        || key.contains('\0')
        || value.as_ref().is_some_and(|s| s.len() > 256 * 1024)
        || !["get", "store", "delete"].contains(&action.as_str())
    {
        return Err("Invalid extension secret operation".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ExtensionSecrets>();
        let _lock = state
            .0
            .lock()
            .map_err(|_| "Extension credential store is busy")?;
        if !crate::extensions::for_app(&app)?
            .iter()
            .any(|e| e.enabled && e.id == id)
        {
            return Err("Extension is not installed or enabled".into());
        }
        let path = app
            .path()
            .app_config_dir()
            .map_err(|_| "Credential directory unavailable")?
            .join("extension-secrets")
            .join(format!("{id}.enc"));
        if !path.exists() && action != "store" {
            return Ok(None);
        }
        let cipher = cipher(&id, !path.exists())?;
        let mut values: BTreeMap<String, String> = if path.exists() {
            if std::fs::metadata(&path)
                .map_err(|_| "Could not inspect extension secrets")?
                .len()
                > MAX as u64
            {
                return Err("Extension credential vault is too large".into());
            }
            serde_json::from_slice(&decrypt(
                &id,
                &cipher,
                std::fs::read(&path).map_err(|_| "Could not read extension secrets")?,
            )?)
            .map_err(|_| "Invalid extension credential record")?
        } else {
            BTreeMap::new()
        };
        if action == "get" {
            return Ok(values.get(&key).cloned());
        }
        if action == "store" {
            values.insert(key, value.ok_or("Secret value is required")?);
        } else {
            values.remove(&key);
        }
        let data = serde_json::to_vec(&values).map_err(|_| "Could not encode extension secrets")?;
        if values.len() > 256 || data.len() > MAX - 28 {
            return Err("Extension credential vault is full".into());
        }
        let data = encrypt(&id, &cipher, data)?;
        let parent = path.parent().unwrap();
        std::fs::create_dir_all(parent).map_err(|_| "Could not create credential directory")?;
        let mut file = tempfile::NamedTempFile::new_in(parent)
            .map_err(|_| "Could not create credential file")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.as_file()
                .set_permissions(std::fs::Permissions::from_mode(0o600))
                .map_err(|_| "Could not protect extension secrets")?;
        }
        file.write_all(&data)
            .and_then(|_| file.as_file().sync_all())
            .map_err(|_| "Could not save extension secrets")?;
        file.persist(path)
            .map_err(|_| "Could not replace extension secrets")?;
        Ok(None)
    })
    .await
    .map_err(|_| "Extension credential operation failed")?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn secrets_are_authenticated_encrypted_and_bound_to_the_extension() {
        let key =
            aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_256_GCM, &[4; 32]).unwrap());
        let bytes = encrypt("test.one", &key, b"private-token".to_vec()).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("private-token"));
        assert_eq!(
            decrypt("test.one", &key, bytes.clone()).unwrap(),
            b"private-token"
        );
        assert!(decrypt("test.two", &key, bytes.clone()).is_err());
        let mut tampered = bytes;
        tampered[17] ^= 1;
        assert!(decrypt("test.one", &key, tampered).is_err());
    }
}
