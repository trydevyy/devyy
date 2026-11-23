use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use std::{env, fs, path::PathBuf};

pub fn seal_webhook(variable: &str) {
    println!("cargo:rerun-if-env-changed={variable}");
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("webhook.bin");
    let value = env::var(variable).unwrap_or_default();
    if value.trim().is_empty() {
        fs::write(out, []).unwrap();
        return;
    }

    let random = SystemRandom::new();
    let mut key = [0; 32];
    let mut nonce = [0; 12];
    random
        .fill(&mut key)
        .expect("generate webhook encryption key");
    random.fill(&mut nonce).expect("generate webhook nonce");
    let cipher = aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_256_GCM, &key).unwrap());
    let mut encrypted = value.trim().as_bytes().to_vec();
    cipher
        .seal_in_place_append_tag(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::empty(),
            &mut encrypted,
        )
        .expect("encrypt webhook");
    // The client needs the key at runtime. This only conceals the URL from plaintext inspection.
    fs::write(out, [key.as_slice(), nonce.as_slice(), &encrypted].concat()).unwrap();
}
