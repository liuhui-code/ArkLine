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

#[derive(Debug, Clone)]
struct ResolvedHvigor {
    command: PathBuf,
    source: &'static str,
    deveco_contents: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct ResolvedNode {
    bin_dir: PathBuf,
    home: Option<PathBuf>,
}

pub fn resolve_build_environment(request: &BuildEnvironmentRequest) -> BuildEnvironmentResolution {
    let hvigor = resolve_hvigor(request);
    let node = resolve_node_path(request, hvigor.as_ref());
    let sdk = resolve_sdk_path(request);
    let mut checks = Vec::new();
    checks.push(check_hvigor(hvigor.as_ref(), request));
    checks.push(check_node(node.as_ref(), request));
    checks.push(check_sdk(sdk.as_ref(), request));

    let mut path_entries = Vec::new();
    if let Some(node) = node.as_ref() {
        push_unique_path(&mut path_entries, node.bin_dir.clone());
    }
    if let Some(sdk_path) = sdk.as_ref() {
        for suffix in ["toolchains", "ets"] {
            push_unique_path(&mut path_entries, sdk_path.join(suffix));
        }
    }
    let project_bin = PathBuf::from(&request.root_path)
        .join("node_modules")
        .join(".bin");
    if project_bin.is_dir() {
        push_unique_path(&mut path_entries, project_bin);
    }

    let mut environment = HashMap::new();
    if let Some(sdk_path) = sdk.as_ref() {
        let sdk_value = sdk_path.to_string_lossy().to_string();
        for name in SDK_ENV_NAMES
            .into_iter()
            .filter(|name| *name != "DEVECO_SDK_HOME")
        {
            environment.insert(name.to_string(), sdk_value.clone());
        }
        if let Some(build_root) = hvigor
            .as_ref()
            .and_then(|value| value.deveco_contents.as_ref())
            .map(|contents| contents.join("sdk"))
            .filter(|path| path.is_dir())
            .or_else(|| deveco_sdk_root(sdk_path))
        {
            environment.insert(
                "DEVECO_SDK_HOME".to_string(),
                build_root.to_string_lossy().to_string(),
            );
        }
    }
    if let Some(node) = node.as_ref() {
        let node_value = node.bin_dir.to_string_lossy().to_string();
        environment.insert("ARKLINE_NODE_PATH".to_string(), node_value);
        if let Some(home) = node.home.as_ref() {
            environment.insert("NODE_HOME".to_string(), home.to_string_lossy().to_string());
        }
    }

    BuildEnvironmentResolution {
        can_build: checks.iter().all(|check| check.available),
        hvigor_command: hvigor
            .as_ref()
            .map(|value| value.command.to_string_lossy().to_string()),
        hvigor_source: hvigor.as_ref().map(|value| value.source.to_string()),
        node_path: node.map(|value| value.bin_dir.to_string_lossy().to_string()),
        sdk_path: sdk.map(|path| path.to_string_lossy().to_string()),
        path_entries,
        environment,
        checks,
    }
}

fn resolve_node_path(
    request: &BuildEnvironmentRequest,
    hvigor: Option<&ResolvedHvigor>,
) -> Option<ResolvedNode> {
    let mut candidates = Vec::new();
    if !request.node_path.trim().is_empty() {
        candidates.push(PathBuf::from(request.node_path.trim()));
    }
    if request.auto_detect {
        if let Some(contents) = hvigor.and_then(|value| value.deveco_contents.as_ref()) {
            candidates.push(contents.join("tools").join("node"));
        }
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

fn resolve_hvigor(request: &BuildEnvironmentRequest) -> Option<ResolvedHvigor> {
    resolve_hvigor_from_candidates(request, default_deveco_hvigor_candidates())
}

fn resolve_hvigor_from_candidates(
    request: &BuildEnvironmentRequest,
    deveco_candidates: Vec<PathBuf>,
) -> Option<ResolvedHvigor> {
    let root = PathBuf::from(&request.root_path);
    let unix_wrapper = root.join("hvigorw");
    let windows_wrapper = root.join("hvigorw.bat");
    let wrapper = if cfg!(windows) && windows_wrapper.is_file() {
        Some(windows_wrapper)
    } else if !cfg!(windows) && unix_wrapper.is_file() {
        Some(unix_wrapper)
    } else {
        None
    };
    if let Some(command) = wrapper.filter(|path| wrapper_is_usable(path)) {
        return Some(ResolvedHvigor {
            command,
            source: "project-wrapper",
            deveco_contents: None,
        });
    }
    if !request.auto_detect {
        return None;
    }
    deveco_candidates
        .into_iter()
        .find(|path| wrapper_is_usable(path))
        .and_then(resolved_deveco_hvigor)
}

fn check_hvigor(
    hvigor: Option<&ResolvedHvigor>,
    request: &BuildEnvironmentRequest,
) -> BuildEnvironmentCheck {
    let root = PathBuf::from(&request.root_path);
    BuildEnvironmentCheck {
        name: "hvigor".to_string(),
        available: hvigor.is_some(),
        detail: hvigor.map_or_else(
            || {
                let expected = if cfg!(windows) { "hvigorw.bat" } else { "hvigorw" };
                format!(
                    "No {expected} found at canonical project root {}, and no supported DevEco Hvigor installation was detected.",
                    root.display()
                )
            },
            |value| format!("Hvigor {} ready at {}", value.source, value.command.display()),
        ),
    }
}

fn default_deveco_hvigor_candidates() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        return ["DevEco-Studio.app", "DevEco Studio.app"]
            .into_iter()
            .map(|app| {
                PathBuf::from("/Applications")
                    .join(app)
                    .join("Contents/tools/hvigor/bin/hvigorw")
            })
            .collect();
    }
    Vec::new()
}

fn resolved_deveco_hvigor(command: PathBuf) -> Option<ResolvedHvigor> {
    let contents = command.ancestors().nth(4)?.to_path_buf();
    Some(ResolvedHvigor {
        command,
        source: "deveco",
        deveco_contents: Some(contents),
    })
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

fn normalize_node_path(path: PathBuf) -> Option<ResolvedNode> {
    if path.is_file() {
        return path.parent().map(|bin_dir| ResolvedNode {
            bin_dir: bin_dir.to_path_buf(),
            home: node_home_for_bin(bin_dir),
        });
    }
    if !path.is_dir() {
        return None;
    }
    let executable = if cfg!(windows) { "node.exe" } else { "node" };
    if path.join("bin").join(executable).is_file() {
        return Some(ResolvedNode {
            bin_dir: path.join("bin"),
            home: Some(path),
        });
    }
    path.join(executable).is_file().then(|| ResolvedNode {
        home: node_home_for_bin(&path),
        bin_dir: path,
    })
}

fn node_home_for_bin(bin_dir: &Path) -> Option<PathBuf> {
    if cfg!(windows) {
        return Some(bin_dir.to_path_buf());
    }
    (bin_dir.file_name().and_then(|name| name.to_str()) == Some("bin"))
        .then(|| bin_dir.parent().map(Path::to_path_buf))
        .flatten()
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

fn deveco_sdk_root(sdk_path: &Path) -> Option<PathBuf> {
    let default = sdk_path.parent()?;
    if default.file_name().and_then(|name| name.to_str()) != Some("default") {
        return None;
    }
    default
        .parent()
        .map(Path::to_path_buf)
        .filter(|path| path.is_dir())
}

fn check_node(
    node: Option<&ResolvedNode>,
    request: &BuildEnvironmentRequest,
) -> BuildEnvironmentCheck {
    let detail = match node {
        Some(value) => format!("Node runtime ready at {}", value.bin_dir.display()),
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

    use super::{resolve_build_environment, resolve_hvigor_from_candidates, resolve_node_path};
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
        let node_home = root.join("node-home");
        let node = node_home.join("bin/node");
        let sdk = root.join("sdk");
        fs::create_dir_all(node.parent().unwrap()).unwrap();
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
            node_path: node_home.to_string_lossy().to_string(),
            auto_detect: false,
        });

        assert!(resolution.can_build);
        assert_eq!(
            resolution.node_path,
            Some(node_home.join("bin").to_string_lossy().to_string())
        );
        assert_eq!(resolution.sdk_path, Some(sdk.to_string_lossy().to_string()));
        assert_eq!(
            resolution.path_entries[0],
            node_home.join("bin").to_string_lossy()
        );
        assert_eq!(
            resolution.environment["HOS_SDK_HOME"],
            sdk.to_string_lossy()
        );
        assert_eq!(
            resolution.environment["NODE_HOME"],
            node_home.to_string_lossy()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn explains_a_missing_wrapper_at_the_canonical_project_root() {
        let root = temporary_root();
        let node = root.join("node");
        let sdk = root.join("sdk");
        fs::create_dir_all(sdk.join("ets")).unwrap();
        fs::create_dir_all(sdk.join("toolchains")).unwrap();
        fs::write(&node, "node").unwrap();
        fs::write(root.join("hvigorfile.ts"), "export {}").unwrap();
        fs::write(root.join("build-profile.json5"), "{}").unwrap();

        let resolution = resolve_build_environment(&BuildEnvironmentRequest {
            root_path: root.to_string_lossy().to_string(),
            harmony_sdk_path: sdk.to_string_lossy().to_string(),
            node_path: node.to_string_lossy().to_string(),
            auto_detect: false,
        });

        let hvigor = resolution
            .checks
            .iter()
            .find(|check| check.name == "hvigor")
            .unwrap();
        assert!(!hvigor.available);
        assert!(hvigor.detail.contains("canonical project root"));
        assert!(hvigor.detail.contains(root.to_string_lossy().as_ref()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn falls_back_to_deveco_hvigor_and_its_bundled_node() {
        let contents = temporary_root().join("DevEco-Studio.app/Contents");
        let project = contents.join("workspace");
        let hvigor = contents.join("tools/hvigor/bin/hvigorw");
        let node = contents.join("tools/node/bin/node");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(hvigor.parent().unwrap()).unwrap();
        fs::create_dir_all(node.parent().unwrap()).unwrap();
        fs::write(&hvigor, "#!/bin/sh").unwrap();
        fs::write(&node, "node").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&hvigor).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&hvigor, permissions).unwrap();
        }
        let request = BuildEnvironmentRequest {
            root_path: project.to_string_lossy().to_string(),
            harmony_sdk_path: String::new(),
            node_path: String::new(),
            auto_detect: true,
        };

        let resolved = resolve_hvigor_from_candidates(&request, vec![hvigor.clone()]).unwrap();
        let resolved_node = resolve_node_path(&request, Some(&resolved)).unwrap();

        assert_eq!(resolved.source, "deveco");
        assert_eq!(resolved.command, hvigor);
        assert_eq!(resolved_node.bin_dir, contents.join("tools/node/bin"));
        assert_eq!(resolved_node.home, Some(contents.join("tools/node")));
        fs::remove_dir_all(contents.parent().unwrap().parent().unwrap()).unwrap();
    }
}
