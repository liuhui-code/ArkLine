use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::build_environment::{
    BuildEnvironmentCheck, BuildEnvironmentRequest, BuildEnvironmentResolution,
};
use crate::services::process_command_service::hidden_command;
use crate::services::semantic_host::sdk::discover_harmony_sdk;

#[path = "build_dependency_service.rs"]
mod build_dependency_service;
use build_dependency_service::dependency_restore_required;

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
    resolve_build_environment_from_candidates(request, default_deveco_hvigor_candidates())
}

fn resolve_build_environment_from_candidates(
    request: &BuildEnvironmentRequest,
    deveco_candidates: Vec<PathBuf>,
) -> BuildEnvironmentResolution {
    let ohpm_candidates = deveco_ohpm_candidates(&deveco_candidates);
    let hvigor = resolve_hvigor_from_candidates(request, deveco_candidates);
    let node = resolve_node_path(request, hvigor.as_ref());
    let sdk = resolve_sdk_path(request, hvigor.as_ref());
    let dependency_restore_required = dependency_restore_required(Path::new(&request.root_path));
    let ohpm = resolve_ohpm(request, hvigor.as_ref(), ohpm_candidates);
    let mut checks = Vec::new();
    checks.push(check_hvigor(hvigor.as_ref(), request));
    checks.push(check_node(node.as_ref(), request));
    checks.push(check_sdk(sdk.as_ref(), request));
    checks.push(check_ohpm(ohpm.as_ref(), dependency_restore_required));

    let mut path_entries = Vec::new();
    if let Some(node) = node.as_ref() {
        push_unique_path(&mut path_entries, node.bin_dir.clone());
    }
    if let Some(command) = ohpm.as_ref() {
        if let Some(parent) = command.parent() {
            push_unique_path(&mut path_entries, parent.to_path_buf());
        }
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
        ohpm_command: ohpm.map(|value| value.to_string_lossy().to_string()),
        dependency_restore_required,
        node_path: node.map(|value| value.bin_dir.to_string_lossy().to_string()),
        sdk_api_version: sdk.as_deref().and_then(read_sdk_api_version),
        sdk_path: sdk.map(|path| path.to_string_lossy().to_string()),
        path_entries,
        environment,
        checks,
    }
}

fn deveco_ohpm_candidates(hvigor_candidates: &[PathBuf]) -> Vec<PathBuf> {
    hvigor_candidates
        .iter()
        .filter_map(|command| command.ancestors().nth(4))
        .map(|contents| {
            contents
                .join("tools/ohpm/bin")
                .join(if cfg!(windows) { "ohpm.bat" } else { "ohpm" })
        })
        .collect()
}

fn resolve_ohpm(
    request: &BuildEnvironmentRequest,
    hvigor: Option<&ResolvedHvigor>,
    mut candidates: Vec<PathBuf>,
) -> Option<PathBuf> {
    if let Some(contents) = hvigor.and_then(|value| value.deveco_contents.as_ref()) {
        candidates.insert(
            0,
            contents
                .join("tools/ohpm/bin")
                .join(if cfg!(windows) { "ohpm.bat" } else { "ohpm" }),
        );
    }
    if request.auto_detect {
        if let Some(command) = lookup_command("ohpm") {
            candidates.push(command);
        }
    }
    candidates.into_iter().find(|path| wrapper_is_usable(path))
}

fn check_ohpm(ohpm: Option<&PathBuf>, dependency_restore_required: bool) -> BuildEnvironmentCheck {
    BuildEnvironmentCheck {
        name: "ohpm".to_string(),
        available: !dependency_restore_required || ohpm.is_some(),
        detail: if !dependency_restore_required {
            "Dependency restore is not required".to_string()
        } else {
            ohpm.map_or_else(
                || "Dependencies are missing, but ohpm was not found in the selected DevEco installation or PATH".to_string(),
                |command| format!("Dependency restore ready with {}", command.display()),
            )
        },
    }
}

fn read_sdk_api_version(sdk_path: &Path) -> Option<String> {
    ["toolchains", "ets", "js", "native"]
        .into_iter()
        .map(|component| sdk_path.join(component).join("oh-uni-package.json"))
        .find_map(|manifest| {
            let content = fs::read_to_string(manifest).ok()?;
            let value: serde_json::Value = serde_json::from_str(&content).ok()?;
            match value.get("apiVersion")? {
                serde_json::Value::String(version) => Some(version.clone()),
                serde_json::Value::Number(version) => Some(version.to_string()),
                _ => None,
            }
        })
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
    let program_files = ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"]
        .into_iter()
        .filter_map(env::var_os)
        .map(PathBuf::from)
        .collect();
    deveco_hvigor_candidates(
        env::consts::OS,
        program_files,
        env::var_os("LOCALAPPDATA").map(PathBuf::from),
    )
}

fn deveco_hvigor_candidates(
    platform: &str,
    program_files: Vec<PathBuf>,
    local_app_data: Option<PathBuf>,
) -> Vec<PathBuf> {
    if platform == "macos" {
        return ["DevEco-Studio.app", "DevEco Studio.app"]
            .into_iter()
            .map(|app| PathBuf::from("/Applications").join(app).join("Contents"))
            .map(|root| root.join("tools/hvigor/bin/hvigorw"))
            .collect();
    }
    if platform == "windows" {
        let mut install_roots = Vec::new();
        for root in program_files {
            install_roots.push(root.join("Huawei/DevEco Studio"));
            install_roots.push(root.join("Huawei/DevEco-Studio"));
            install_roots.push(root.join("DevEco Studio"));
        }
        if let Some(root) = local_app_data {
            install_roots.push(root.join("Programs/DevEco Studio"));
            install_roots.push(root.join("Programs/DevEco-Studio"));
        }
        return install_roots
            .into_iter()
            .map(|root| root.join("tools/hvigor/bin/hvigorw.bat"))
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
    lookup_command("node")
}

fn lookup_command(name: &str) -> Option<PathBuf> {
    let command = if cfg!(windows) { "where" } else { "which" };
    let output = hidden_command(command).arg(name).output().ok()?;
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
    let executable_names = if cfg!(windows) {
        ["node.exe", "node"]
    } else {
        ["node", "node.exe"]
    };
    for executable in executable_names {
        if path.join("bin").join(executable).is_file() {
            return Some(ResolvedNode {
                bin_dir: path.join("bin"),
                home: Some(path),
            });
        }
        if path.join(executable).is_file() {
            return Some(ResolvedNode {
                home: if executable == "node.exe" {
                    Some(path.clone())
                } else {
                    node_home_for_bin(&path)
                },
                bin_dir: path,
            });
        }
    }
    None
}

fn node_home_for_bin(bin_dir: &Path) -> Option<PathBuf> {
    if cfg!(windows) {
        return Some(bin_dir.to_path_buf());
    }
    (bin_dir.file_name().and_then(|name| name.to_str()) == Some("bin"))
        .then(|| bin_dir.parent().map(Path::to_path_buf))
        .flatten()
}

fn resolve_sdk_path(
    request: &BuildEnvironmentRequest,
    hvigor: Option<&ResolvedHvigor>,
) -> Option<PathBuf> {
    let configured = request.harmony_sdk_path.trim();
    if !configured.is_empty() {
        return discover_harmony_sdk(Some(configured)).into_ready();
    }
    if !request.auto_detect {
        return None;
    }
    if let Some(path) = hvigor
        .and_then(|value| value.deveco_contents.as_ref())
        .map(|root| root.join("sdk"))
        .and_then(|path| discover_harmony_sdk(Some(path.to_string_lossy().as_ref())).into_ready())
    {
        return Some(path);
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
#[path = "build_environment_service_tests.rs"]
mod tests;
