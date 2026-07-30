use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;

use crate::models::build_project::HarmonyBuildProject;

pub fn inspect_harmony_build_project(root_path: &str) -> Result<HarmonyBuildProject, String> {
    let selected_path = PathBuf::from(root_path);
    if !selected_path.exists() {
        return Err(format!(
            "Project path does not exist: {}",
            selected_path.display()
        ));
    }
    let selected_dir = if selected_path.is_file() {
        match selected_path.parent() {
            Some(parent) => parent.to_path_buf(),
            None => selected_path,
        }
    } else {
        selected_path
    };
    let root = find_harmony_project_root(&selected_dir);

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
        hvigor_wrapper_command: if cfg!(windows) && has_windows_wrapper {
            Some("hvigorw.bat".to_string())
        } else if !cfg!(windows) && has_unix_wrapper {
            Some("./hvigorw".to_string())
        } else if has_windows_wrapper {
            Some("hvigorw.bat".to_string())
        } else if has_unix_wrapper {
            Some("./hvigorw".to_string())
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

fn find_harmony_project_root(selected_dir: &Path) -> PathBuf {
    let mut current = selected_dir.to_path_buf();
    loop {
        if has_harmony_project_marker(&current) {
            return current;
        }
        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => return selected_dir.to_path_buf(),
        }
    }
}

fn has_harmony_project_marker(path: &Path) -> bool {
    path.join("hvigorw").is_file()
        || path.join("hvigorw.bat").is_file()
        || path.join("hvigorfile.ts").is_file()
        || path.join("build-profile.json5").is_file()
        || path.join("oh-package.json5").is_file()
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
    modules.extend(discover_profile_modules(root));
    modules.sort();
    modules.dedup();
    Ok(modules)
}

fn discover_profile_modules(root: &Path) -> Vec<String> {
    let content = fs::read_to_string(root.join("build-profile.json5")).unwrap_or_default();
    let Some(array) = named_array_body(&content, "modules") else {
        return Vec::new();
    };
    let name_pattern =
        Regex::new(r#"\bname\s*:\s*["']([^"']+)["']"#).expect("module name pattern should compile");
    name_pattern
        .captures_iter(array)
        .filter_map(|capture| {
            capture
                .get(1)
                .map(|value| value.as_str().trim().to_string())
        })
        .filter(|name| !name.is_empty() && root.join(name).is_dir())
        .collect()
}

fn named_array_body<'a>(content: &'a str, name: &str) -> Option<&'a str> {
    let marker = Regex::new(&format!(r#"\b{name}\s*:\s*\["#)).ok()?;
    let marker_match = marker.find(content)?;
    let start = marker_match.end();
    let bytes = content.as_bytes();
    let mut depth = 1;
    let mut quote = None;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;
    let mut index = start;

    while index < bytes.len() {
        let current = bytes[index] as char;
        let next = bytes.get(index + 1).copied().map(char::from);
        if line_comment {
            line_comment = current != '\n';
        } else if block_comment {
            if current == '*' && next == Some('/') {
                block_comment = false;
                index += 1;
            }
        } else if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if current == '\\' {
                escaped = true;
            } else if current == active_quote {
                quote = None;
            }
        } else if current == '/' && next == Some('/') {
            line_comment = true;
            index += 1;
        } else if current == '/' && next == Some('*') {
            block_comment = true;
            index += 1;
        } else if current == '"' || current == '\'' {
            quote = Some(current);
        } else if current == '[' {
            depth += 1;
        } else if current == ']' {
            depth -= 1;
            if depth == 0 {
                return content.get(start..index);
            }
        }
        index += 1;
    }
    content.get(start..)
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

    #[test]
    fn resolves_project_root_from_a_selected_module_directory() {
        let repo = std::env::temp_dir().join(format!(
            "arkline-build-project-nested-{}",
            std::process::id()
        ));
        let root = repo.join("apps/Demo");
        let selected = root.join("entry/src/main/ets");
        let _ = fs::remove_dir_all(&repo);
        fs::create_dir_all(&selected).unwrap();
        fs::write(root.join("hvigorw"), "#!/bin/sh").unwrap();
        fs::write(root.join("hvigorfile.ts"), "export {}").unwrap();
        fs::write(root.join("build-profile.json5"), "{}").unwrap();

        let project = inspect_harmony_build_project(selected.to_str().unwrap()).unwrap();

        assert_eq!(project.root_path, root.to_string_lossy());
        assert!(project.is_harmony_project);
        assert_eq!(project.modules, vec!["entry"]);
        fs::remove_dir_all(repo).unwrap();
    }

    #[test]
    fn resolves_project_root_from_an_active_file() {
        let repo =
            std::env::temp_dir().join(format!("arkline-build-project-file-{}", std::process::id()));
        let root = repo.join("apps/Demo");
        let file = root.join("entry/src/main/ets/Index.ets");
        let _ = fs::remove_dir_all(&repo);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "@Entry struct Index {}").unwrap();
        fs::write(root.join("hvigorw.bat"), "").unwrap();
        fs::write(root.join("oh-package.json5"), "{}").unwrap();

        let project = inspect_harmony_build_project(file.to_str().unwrap()).unwrap();

        assert_eq!(project.root_path, root.to_string_lossy());
        assert_eq!(
            project.hvigor_wrapper_command.as_deref(),
            Some("hvigorw.bat")
        );
        assert_eq!(project.default_module.as_deref(), Some("entry"));
        fs::remove_dir_all(repo).unwrap();
    }

    #[test]
    fn merges_modules_declared_by_build_profile() {
        let root = std::env::temp_dir().join(format!(
            "arkline-build-project-profile-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("feature")).unwrap();
        fs::write(root.join("hvigorw"), "#!/bin/sh").unwrap();
        fs::write(root.join("hvigorfile.ts"), "export {}").unwrap();
        fs::write(
            root.join("build-profile.json5"),
            "{ modules: [{ name: 'feature' }] }",
        )
        .unwrap();

        let project = inspect_harmony_build_project(root.to_str().unwrap()).unwrap();

        assert_eq!(project.modules, vec!["feature"]);
        fs::remove_dir_all(root).unwrap();
    }
}
