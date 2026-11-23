use ring::aead;

pub fn url() -> Option<reqwest::Url> {
    let bytes = include_bytes!(concat!(env!("OUT_DIR"), "/webhook.bin")).as_slice();
    let (key, rest) = bytes.split_at_checked(32)?;
    let (nonce, encrypted) = rest.split_at_checked(12)?;
    let cipher = aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_256_GCM, key).ok()?);
    let mut encrypted = encrypted.to_vec();
    let plaintext = cipher
        .open_in_place(
            aead::Nonce::try_assume_unique_for_key(nonce).ok()?,
            aead::Aad::empty(),
            &mut encrypted,
        )
        .ok()?;
    let url = reqwest::Url::parse(std::str::from_utf8(plaintext).ok()?).ok()?;
    (url.scheme() == "https"
        && matches!(url.host_str(), Some("discord.com" | "discordapp.com"))
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().starts_with("/api/webhooks/"))
    .then_some(url)
}
