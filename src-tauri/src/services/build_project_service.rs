use std::fs;
use std::path::{Path, PathBuf};

use crate::models::build_project::HarmonyBuildProject;

pub fn inspect_harmony_build_project(root_path: &str) -> Result<HarmonyBuildProject, String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err(format!(
            "Project directory does not exist: {}",
            root.display()
        ));
    }

    let has_unix_wrapper = root.join("hvigorw").is_file();
    let has_windows_wrapper = root.join("hvigorw.bat").is_file();
    let modules = discover_modules(&root)?;
    let has_hvigor_file = root.join("hvigorfile.ts").is_file();
    let has_build_profile = root.join("build-profile.json5").is_file();
    let has_oh_package = root.join("oh-package.json5").is_file();
    let is_harmony_project =
        has_hvigor_file || has_build_profile || has_oh_package || !modules.is_empty();
    let default_module = modules
        .iter()
        .find(|module_name| module_name.as_str() == "entry")
        .cloned()
        .or_else(|| modules.first().cloned());

    Ok(HarmonyBuildProject {
        root_path: root.to_string_lossy().to_string(),
        is_harmony_project,
        has_hvigor_wrapper: has_unix_wrapper || has_windows_wrapper,
        hvigor_wrapper_command: if has_unix_wrapper {
            Some("./hvigorw".to_string())
        } else if has_windows_wrapper {
            Some("hvigorw.bat".to_string())
        } else {
            None
        },
        has_hvigor_file,
        has_build_profile,
        has_oh_package,
        modules,
        default_module,
    })
}

fn discover_modules(root: &Path) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(root).map_err(|error| error.to_string())?;
    let mut modules = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let module_path = entry.path();
            module_path
                .join("src/main")
                .is_dir()
                .then(|| entry.file_name().to_string_lossy().to_string())
        })
        .collect::<Vec<_>>();
    modules.sort();
    modules.dedup();
    Ok(modules)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::inspect_harmony_build_project;

    #[test]
    fn detects_root_markers_and_modules_without_a_workspace_scan() {
        let root =
            std::env::temp_dir().join(format!("arkline-build-project-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("entry/src/main/ets")).unwrap();
        fs::write(root.join("hvigorw"), "#!/bin/sh").unwrap();
        fs::write(root.join("hvigorfile.ts"), "export {}").unwrap();
        fs::write(root.join("build-profile.json5"), "{}").unwrap();

        let project = inspect_harmony_build_project(root.to_str().unwrap()).unwrap();

        assert!(project.is_harmony_project);
        assert_eq!(project.hvigor_wrapper_command.as_deref(), Some("./hvigorw"));
        assert_eq!(project.modules, vec!["entry"]);
        assert_eq!(project.default_module.as_deref(), Some("entry"));
        fs::remove_dir_all(root).unwrap();
    }
}
