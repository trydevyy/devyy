use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
struct Config {
    bundle: Bundle,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
    file_associations: Vec<FileType>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileType {
    pub ext: Vec<String>,
    #[cfg_attr(not(windows), allow(dead_code))]
    pub name: String,
    pub mime_type: String,
}

pub fn types() -> &'static [FileType] {
    static TYPES: OnceLock<Vec<FileType>> = OnceLock::new();
    TYPES.get_or_init(|| {
        serde_json::from_str::<Config>(include_str!("../src-tauri/tauri.conf.json"))
            .expect("Devyy has a valid file association catalog")
            .bundle
            .file_associations
    })
}
