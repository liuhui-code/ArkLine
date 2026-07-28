use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::build_environment::{
    BuildEnvironmentCheck, BuildEnvironmentRequest, BuildEnvironmentResolution,
};
use crate::services::process_command_service::hidden_command;
use crate::services::semantic_host::sdk::discover_harmony_sdk;

const SDK_ENV_NAMES: [&str; 5] = [
    "ARKLINE_HARMONY_SDK_PATH",
    "HOS_SDK_HOME",
    "OHOS_SDK_HOME",
    "HARMONY_SDK_HOME",
    "DEVECO_SDK_HOME",
];

pub fn resolve_build_environment(
    request: &BuildEnvironmentRequest,
) -> BuildEnvironmentResolution {
    let node = resolve_node_path(request);
    let sdk = resolve_sdk_path(request);
    let mut checks = Vec::new();
    checks.push(check_hvigor_wrapper(request));
    checks.push(check_node(node.as_ref(), request));
    checks.push(check_sdk(sdk.as_ref(), request));

    let mut path_entries = Vec::new();
    if let Some(node_path) = node.as_ref() {
        push_unique_path(&mut path_entries, node_path.clone());
    }
    if let Some(sdk_path) = sdk.as_ref() {
        for suffix in ["toolchains", "ets"] {
            push_unique_path(&mut path_entries, sdk_path.join(suffix));
        }
    }
    let project_bin = PathBuf::from(&request.root_path).join("node_modules").join(".bin");
    if project_bin.is_dir() {
        push_unique_path(&mut path_entries, project_bin);
    }

    let mut environment = HashMap::new();
    if let Some(sdk_path) = sdk.as_ref() {
        let sdk_value = sdk_path.to_string_lossy().to_string();
        for name in SDK_ENV_NAMES {
            environment.insert(name.to_string(), sdk_value.clone());
        }
    }
    if let Some(node_path) = node.as_ref() {
        let node_value = node_path.to_string_lossy().to_string();
        environment.insert("NODE_HOME".to_string(), node_value.clone());
        environment.insert("ARKLINE_NODE_PATH".to_string(), node_value);
    }

    BuildEnvironmentResolution {
        can_build: checks.iter().all(|check| check.available),
        node_path: node.map(|path| path.to_string_lossy().to_string()),
        sdk_path: sdk.map(|path| path.to_string_lossy().to_string()),
        path_entries,
        environment,
        checks,
    }
}

fn resolve_node_path(request: &BuildEnvironmentRequest) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if !request.node_path.trim().is_empty() {
        candidates.push(PathBuf::from(request.node_path.trim()));
    }
    if request.auto_detect {
        for name in ["ARKLINE_NODE_PATH", "NODE_HOME"] {
            if let Some(value) = env::var_os(name) {
                candidates.push(PathBuf::from(value));
            }
        }
        if let Some(path) = lookup_node() {
            candidates.push(path);
        }
    }
    candidates.into_iter().find_map(normalize_node_path)
}

fn check_hvigor_wrapper(request: &BuildEnvironmentRequest) -> BuildEnvironmentCheck {
    let root = PathBuf::from(&request.root_path);
    let unix_wrapper = root.join("hvigorw");
    let windows_wrapper = root.join("hvigorw.bat");
    let wrapper = if cfg!(windows) && windows_wrapper.is_file() {
        Some(windows_wrapper)
    } else if !cfg!(windows) && unix_wrapper.is_file() {
        Some(unix_wrapper)
    } else if windows_wrapper.is_file() {
        Some(windows_wrapper)
    } else if unix_wrapper.is_file() {
        Some(unix_wrapper)
    } else {
        None
    };
    let available = wrapper.as_ref().is_some_and(|path| wrapper_is_usable(path));
    BuildEnvironmentCheck {
        name: "hvigor".to_string(),
        available,
        detail: wrapper.map_or_else(
            || format!("No hvigorw or hvigorw.bat found in {}", root.display()),
            |path| if available {
                format!("Hvigor wrapper ready at {}", path.display())
            } else {
                format!("Hvigor wrapper is not executable: {}", path.display())
            },
        ),
    }
}

fn wrapper_is_usable(path: &Path) -> bool {
    if path.extension().and_then(|value| value.to_str()) == Some("bat") {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
    }
    #[cfg(not(unix))]
    true
}

fn lookup_node() -> Option<PathBuf> {
    let command = if cfg!(windows) { "where" } else { "which" };
    let output = hidden_command(command).arg("node").output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(PathBuf::from)
}

fn normalize_node_path(path: PathBuf) -> Option<PathBuf> {
    if path.is_file() {
        return path.parent().map(Path::to_path_buf);
    }
    if !path.is_dir() {
        return None;
    }
    let executable = if cfg!(windows) { "node.exe" } else { "node" };
    path.join(executable).is_file().then_some(path)
}

fn resolve_sdk_path(request: &BuildEnvironmentRequest) -> Option<PathBuf> {
    let configured = request.harmony_sdk_path.trim();
    if !configured.is_empty() {
        return discover_harmony_sdk(Some(configured)).into_ready();
    }
    if !request.auto_detect {
        return None;
    }
    for name in SDK_ENV_NAMES {
        if let Ok(value) = env::var(name) {
            if let Some(path) = discover_harmony_sdk(Some(&value)).into_ready() {
                return Some(path);
            }
        }
    }
    discover_harmony_sdk(None).into_ready()
}

fn check_node(node: Option<&PathBuf>, request: &BuildEnvironmentRequest) -> BuildEnvironmentCheck {
    let detail = match node {
        Some(path) => format!("Node runtime ready at {}", path.display()),
        None if !request.node_path.trim().is_empty() => format!(
            "Configured Node directory is invalid: {}",
            request.node_path.trim()
        ),
        None => "Node runtime was not found in the configured path or PATH".to_string(),
    };
    BuildEnvironmentCheck {
        name: "node".to_string(),
        available: node.is_some(),
        detail,
    }
}

fn check_sdk(sdk: Option<&PathBuf>, request: &BuildEnvironmentRequest) -> BuildEnvironmentCheck {
    let detail = match sdk {
        Some(path) => format!("HarmonyOS SDK ready at {}", path.display()),
        None if !request.harmony_sdk_path.trim().is_empty() => format!(
            "Configured HarmonyOS SDK directory is invalid: {}",
            request.harmony_sdk_path.trim()
        ),
        None => "HarmonyOS SDK was not found in settings, supported environment variables, or DevEco defaults".to_string(),
    };
    BuildEnvironmentCheck {
        name: "harmonySdk".to_string(),
        available: sdk.is_some(),
        detail,
    }
}

fn push_unique_path(paths: &mut Vec<String>, path: PathBuf) {
    if !path.is_dir() {
        return;
    }
    let value = path.to_string_lossy().to_string();
    if !paths.iter().any(|existing| existing == &value) {
        paths.push(value);
    }
}

trait IntoReady {
    fn into_ready(self) -> Option<PathBuf>;
}

impl IntoReady for crate::services::semantic_host::sdk::SdkDiscovery {
    fn into_ready(self) -> Option<PathBuf> {
        match self {
            Self::Ready(path) => Some(path),
            Self::Missing => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::resolve_build_environment;
    use crate::models::build_environment::BuildEnvironmentRequest;

    fn temporary_root() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-build-environment-{suffix}"))
    }

    #[test]
    fn resolves_configured_node_and_sdk_into_one_build_environment() {
        let root = temporary_root();
        let node = root.join("node");
        let sdk = root.join("sdk");
        fs::create_dir_all(sdk.join("ets")).unwrap();
        fs::create_dir_all(sdk.join("toolchains")).unwrap();
        fs::write(&node, "node").unwrap();
        let wrapper = root.join("hvigorw");
        fs::write(&wrapper, "#!/bin/sh").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&wrapper).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&wrapper, permissions).unwrap();
        }

        let resolution = resolve_build_environment(&BuildEnvironmentRequest {
            root_path: root.to_string_lossy().to_string(),
            harmony_sdk_path: sdk.to_string_lossy().to_string(),
            node_path: node.to_string_lossy().to_string(),
            auto_detect: false,
        });

        assert!(resolution.can_build);
        assert_eq!(resolution.node_path, Some(root.to_string_lossy().to_string()));
        assert_eq!(resolution.sdk_path, Some(sdk.to_string_lossy().to_string()));
        assert_eq!(resolution.path_entries[0], root.to_string_lossy());
        assert_eq!(resolution.environment["HOS_SDK_HOME"], sdk.to_string_lossy());
        assert_eq!(resolution.environment["NODE_HOME"], root.to_string_lossy());
        fs::remove_dir_all(root).unwrap();
    }
}
