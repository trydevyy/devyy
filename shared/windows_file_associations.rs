use std::{io, path::Path, ptr::null};
use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
use winreg::{
    enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER},
    RegKey,
};

const APPLICATION: &str = r"Applications\devyy.exe";
const CAPABILITIES: &str = r"Software\Devyy\Capabilities";
const VERBS: &[(&str, &str)] = &[
    (r"*\shell\Devyy.Open", "%1"),
    (r"Directory\shell\Devyy.Open", "%1"),
    (r"Directory\Background\shell\Devyy.Open", "%V"),
];

fn open_command(executable: &Path, target: &str) -> String {
    format!("\"{}\" \"{target}\"", executable.display())
}

pub fn handler(ext: &str) -> Option<String> {
    let user = RegKey::predef(HKEY_CURRENT_USER);
    let choice =
        format!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.{ext}\UserChoice");
    user.open_subkey(choice)
        .ok()
        .and_then(|key| key.get_value("ProgId").ok())
        .or_else(|| {
            RegKey::predef(HKEY_CLASSES_ROOT)
                .open_subkey(format!(".{ext}"))
                .ok()?
                .get_value("")
                .ok()
        })
}

pub fn register(
    executable: &Path,
    selected: Option<&str>,
    explorer_context_menu: Option<bool>,
) -> io::Result<()> {
    register_in(
        &RegKey::predef(HKEY_CURRENT_USER),
        executable,
        selected,
        explorer_context_menu,
    )?;
    notify_explorer();
    Ok(())
}

fn register_in(
    user: &RegKey,
    executable: &Path,
    selected: Option<&str>,
    explorer_context_menu: Option<bool>,
) -> io::Result<()> {
    let classes = user.create_subkey(r"Software\Classes")?.0;
    let application = classes.create_subkey(APPLICATION)?.0;
    let command = open_command(executable, "%1");
    application.set_value("FriendlyAppName", &"Devyy")?;
    application
        .create_subkey(r"shell\open\command")?
        .0
        .set_value("", &command)?;
    let supported = application.create_subkey("SupportedTypes")?.0;

    let capabilities = user.create_subkey(CAPABILITIES)?.0;
    capabilities.set_value("ApplicationName", &"Devyy")?;
    capabilities.set_value(
        "ApplicationDescription",
        &"A focused development environment and IDE",
    )?;
    user.create_subkey(r"Software\RegisteredApplications")?
        .0
        .set_value("Devyy", &CAPABILITIES)?;
    let associations = capabilities.create_subkey("FileAssociations")?.0;

    for file_type in crate::file_types::types() {
        for ext in &file_type.ext {
            if selected.is_some_and(|name| name != ext) {
                continue;
            }
            let progid = format!("Devyy.{ext}");
            let file = classes.create_subkey(&progid)?.0;
            file.set_value("", &format!("{} (Devyy)", file_type.name))?;
            file.create_subkey(r"shell\open\command")?
                .0
                .set_value("", &command)?;
            let icon = executable
                .with_file_name("file-icons")
                .join(format!("{ext}.ico"));
            if icon.is_file() {
                file.create_subkey("DefaultIcon")?
                    .0
                    .set_value("", &format!("\"{}\",0", icon.display()))?;
            }
            let extension = format!(".{ext}");
            classes
                .create_subkey(format!(r"{extension}\OpenWithProgids"))?
                .0
                .set_value(&progid, &"")?;
            associations.set_value(&extension, &progid)?;
            supported.set_value(&extension, &"")?;
        }
    }
    if let Some(enabled) = explorer_context_menu {
        update_explorer_verbs(&classes, executable, enabled)?;
    }
    Ok(())
}

fn update_explorer_verbs(classes: &RegKey, executable: &Path, enabled: bool) -> io::Result<()> {
    for (path, argument) in VERBS {
        let command = open_command(executable, argument);
        if enabled {
            let verb = classes.create_subkey(path)?.0;
            verb.set_value("", &"Open in Devyy")?;
            verb.set_value("Icon", &format!("\"{}\",0", executable.display()))?;
            verb.set_value("MultiSelectModel", &"Single")?;
            verb.create_subkey("command")?.0.set_value("", &command)?;
        } else if owns_command(classes, &format!(r"{path}\command"), &command) {
            classes.delete_subkey_all(path)?;
        }
    }
    Ok(())
}

fn owns_command(classes: &RegKey, path: &str, expected: &str) -> bool {
    classes
        .open_subkey(path)
        .ok()
        .and_then(|key| key.get_value::<String, _>("").ok())
        .is_some_and(|command| command.eq_ignore_ascii_case(expected))
}

pub fn unregister(executable: &Path) -> io::Result<()> {
    unregister_in(&RegKey::predef(HKEY_CURRENT_USER), executable)?;
    notify_explorer();
    Ok(())
}

fn unregister_in(user: &RegKey, executable: &Path) -> io::Result<()> {
    let classes = user.open_subkey_with_flags(
        r"Software\Classes",
        winreg::enums::KEY_READ | winreg::enums::KEY_WRITE,
    )?;
    update_explorer_verbs(&classes, executable, false)?;
    let command = open_command(executable, "%1");
    for ext in crate::file_types::types()
        .iter()
        .flat_map(|file_type| &file_type.ext)
    {
        let progid = format!("Devyy.{ext}");
        if owns_command(&classes, &format!(r"{progid}\shell\open\command"), &command) {
            classes.delete_subkey_all(&progid)?;
            if let Ok(key) = classes.open_subkey_with_flags(
                format!(r".{ext}\OpenWithProgids"),
                winreg::enums::KEY_SET_VALUE,
            ) {
                let _ = key.delete_value(&progid);
            }
        }
    }
    if owns_command(
        &classes,
        &format!(r"{APPLICATION}\shell\open\command"),
        &command,
    ) {
        classes.delete_subkey_all(APPLICATION)?;
        let _ = user.delete_subkey_all(CAPABILITIES);
        if let Ok(key) = user.open_subkey_with_flags(
            r"Software\RegisteredApplications",
            winreg::enums::KEY_SET_VALUE,
        ) {
            let _ = key.delete_value("Devyy");
        }
    }
    Ok(())
}

fn notify_explorer() {
    unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, null(), null()) };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explorer_commands_quote_application_and_target() {
        let executable = Path::new(r"C:\Users\User name\Devyy\devyy.exe");
        assert_eq!(
            open_command(executable, "%1"),
            r#""C:\Users\User name\Devyy\devyy.exe" "%1""#
        );
        assert!(open_command(executable, "%V").ends_with(r#""%V""#));
    }

    #[test]
    fn isolated_registry_keeps_file_icons_and_explorer_verbs_in_sync() {
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("Devyy.exe");
        let icons = directory.path().join("file-icons");
        std::fs::create_dir(&icons).unwrap();
        let icon = icons.join("mjs.ico");
        std::fs::write(&icon, b"test icon").unwrap();
        let user = RegKey::predef(HKEY_CURRENT_USER);
        let path = format!(
            r"Software\DevyyRegistryTest\{}",
            directory.path().file_name().unwrap().to_string_lossy()
        );
        let key = user.create_subkey(&path).unwrap().0;
        struct Cleanup<'a>(&'a RegKey, &'a str);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = self.0.delete_subkey_all(self.1);
            }
        }
        let _cleanup = Cleanup(&user, &path);

        register_in(&key, &executable, None, Some(true)).unwrap();
        let icon_key = key
            .open_subkey(r"Software\Classes\Devyy.mjs\DefaultIcon")
            .unwrap();
        assert_eq!(
            icon_key.get_value::<String, _>("").unwrap(),
            format!("\"{}\",0", icon.display())
        );
        for (verb, argument) in VERBS {
            let command = format!(r"Software\Classes\{verb}\command");
            assert!(owns_command(
                &key,
                &command,
                &open_command(&executable, argument)
            ));
        }
        register_in(&key, &executable, None, Some(false)).unwrap();
        register_in(&key, &executable, Some("mjs"), None).unwrap();
        assert!(key
            .open_subkey(r"Software\Classes\Directory\shell\Devyy.Open")
            .is_err());
        assert!(key
            .open_subkey(r"Software\Classes\Devyy.mjs\DefaultIcon")
            .is_ok());
        unregister_in(&key, &executable).unwrap();
        assert!(key.open_subkey(r"Software\Classes\Devyy.mjs").is_err());
        assert!(key
            .open_subkey(r"Software\Classes\Directory\shell\Devyy.Open")
            .is_err());
    }
}
