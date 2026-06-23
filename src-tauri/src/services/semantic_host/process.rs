use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::config::SemanticHostConfig;

pub const ARKLINE_NODE_PATH_ENV: &str = "ARKLINE_NODE_PATH";
pub const ARKLINE_SEMANTIC_WORKER_ENTRY_ENV: &str = "ARKLINE_SEMANTIC_WORKER_ENTRY";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticWorkerDiscovery {
    pub entry_path: Option<PathBuf>,
    pub node_path: Option<PathBuf>,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticWorkerProcessSpec {
    pub entry_path: PathBuf,
    pub node_path: PathBuf,
}

impl SemanticWorkerProcessSpec {
    pub fn discover_with_config(config: &SemanticHostConfig) -> Result<Self, String> {
        let node_path = resolve_node_path(config.node_path.as_deref(), env::consts::OS)?;
        let entry_path = resolve_worker_entry(config.semantic_worker_path.as_deref())?;

        Ok(Self {
            entry_path,
            node_path,
        })
    }
}

pub fn discover_semantic_worker(config: &SemanticHostConfig) -> SemanticWorkerDiscovery {
    match SemanticWorkerProcessSpec::discover_with_config(config) {
        Ok(spec) => SemanticWorkerDiscovery {
            entry_path: Some(spec.entry_path.clone()),
            node_path: Some(spec.node_path.clone()),
            detail: format!(
                "Semantic worker is ready at {} using node {}",
                spec.entry_path.display(),
                spec.node_path.display()
            ),
        },
        Err(detail) => SemanticWorkerDiscovery {
            entry_path: None,
            node_path: None,
            detail,
        },
    }
}

pub fn default_worker_entry_candidate() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate manifest should live inside src-tauri")
        .join("semantic-worker")
        .join("dist")
        .join("main.js")
}

fn resolve_node_path(configured: Option<&str>, platform: &str) -> Result<PathBuf, String> {
    if let Some(path) = configured {
        if !path.trim().is_empty() {
            return resolve_node_directory(PathBuf::from(path), platform);
        }
    }

    let lookup_command = if platform == "windows" {
        "where"
    } else {
        "which"
    };
    let output = Command::new(lookup_command)
        .arg("node")
        .output()
        .map_err(|error| {
            format!("Node runtime is required for the ArkLine semantic worker: {error}")
        })?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "Node runtime is required for the ArkLine semantic worker{}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }

    let stdout_text = String::from_utf8_lossy(&output.stdout).to_string();
    let first_line = stdout_text
        .lines()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| "Node runtime is required for the ArkLine semantic worker".to_string())?;

    Ok(PathBuf::from(first_line.trim()))
}

fn resolve_node_directory(path: PathBuf, platform: &str) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!(
            "{ARKLINE_NODE_PATH_ENV} directory does not exist: {}",
            path.display()
        ));
    }

    if !path.is_dir() {
        return Err(format!(
            "{ARKLINE_NODE_PATH_ENV} path is not a directory: {}",
            path.display()
        ));
    }

    let candidates = if platform == "windows" {
        vec![path.join("node.exe"), path.join("bin").join("node.exe")]
    } else {
        vec![path.join("bin").join("node"), path.join("node")]
    };

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            format!(
                "{ARKLINE_NODE_PATH_ENV} directory does not contain a Node executable: {}",
                path.display()
            )
        })
}

fn resolve_worker_entry(configured: Option<&str>) -> Result<PathBuf, String> {
    if let Some(path) = configured {
        return validate_file_path(PathBuf::from(path), ARKLINE_SEMANTIC_WORKER_ENTRY_ENV);
    }

    validate_file_path(
        default_worker_entry_candidate(),
        ARKLINE_SEMANTIC_WORKER_ENTRY_ENV,
    )
    .map_err(|_| {
        format!(
            "Build semantic-worker/dist/main.js or set {} to a compiled worker entry file",
            ARKLINE_SEMANTIC_WORKER_ENTRY_ENV
        )
    })
}

fn validate_file_path(path: PathBuf, env_name: &str) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!(
            "{env_name} path does not exist: {}",
            path.display()
        ));
    }

    if !path.is_file() {
        return Err(format!("{env_name} path is not a file: {}", path.display()));
    }

    Ok(path)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        default_worker_entry_candidate, resolve_node_path, resolve_worker_entry,
        ARKLINE_NODE_PATH_ENV, ARKLINE_SEMANTIC_WORKER_ENTRY_ENV,
    };

    fn unique_temp_dir(name: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
    }

    #[test]
    fn points_to_repo_local_worker_dist() {
        let candidate = default_worker_entry_candidate();

        assert!(candidate
            .to_string_lossy()
            .contains("semantic-worker/dist/main.js"));
    }

    #[test]
    fn reports_override_for_missing_worker_entry() {
        let error =
            resolve_worker_entry(Some("/tmp/arkline-missing-worker-entry.mjs")).unwrap_err();

        assert!(error.contains(ARKLINE_SEMANTIC_WORKER_ENTRY_ENV));
        assert!(error.contains("does not exist"));
    }

    #[test]
    fn resolve_configured_node_directory_bin_node_for_macos_linux() {
        let root = unique_temp_dir("node-bin");
        let bin = root.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(bin.join("node"), "").unwrap();

        let resolved = resolve_node_path(Some(root.to_string_lossy().as_ref()), "macos").unwrap();

        assert_eq!(resolved, bin.join("node"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolve_configured_node_directory_direct_node_for_linux() {
        let root = unique_temp_dir("node-direct");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("node"), "").unwrap();

        let resolved = resolve_node_path(Some(root.to_string_lossy().as_ref()), "linux").unwrap();

        assert_eq!(resolved, root.join("node"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolve_configured_node_directory_rejects_missing_directory() {
        let root = unique_temp_dir("node-missing-dir");

        let error = resolve_node_path(Some(root.to_string_lossy().as_ref()), "macos").unwrap_err();

        assert!(error.contains(ARKLINE_NODE_PATH_ENV));
        assert!(error.contains("directory does not exist"));
    }

    #[test]
    fn resolve_configured_node_directory_rejects_non_directory() {
        let root = unique_temp_dir("node-file");
        fs::write(&root, "").unwrap();

        let error = resolve_node_path(Some(root.to_string_lossy().as_ref()), "macos").unwrap_err();

        assert!(error.contains(ARKLINE_NODE_PATH_ENV));
        assert!(error.contains("path is not a directory"));
        fs::remove_file(root).unwrap();
    }

    #[test]
    fn resolve_configured_node_directory_rejects_directory_without_executable() {
        let root = unique_temp_dir("node-missing");
        fs::create_dir_all(&root).unwrap();

        let error = resolve_node_path(Some(root.to_string_lossy().as_ref()), "macos").unwrap_err();

        assert!(error.contains(ARKLINE_NODE_PATH_ENV));
        assert!(error.contains("directory does not contain a Node executable"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolve_configured_node_directory_prefers_windows_direct_node_exe() {
        let root = unique_temp_dir("node-windows");
        let bin = root.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(root.join("node.exe"), "").unwrap();
        fs::write(bin.join("node.exe"), "").unwrap();

        let resolved = resolve_node_path(Some(root.to_string_lossy().as_ref()), "windows").unwrap();

        assert_eq!(resolved, root.join("node.exe"));
        fs::remove_dir_all(root).unwrap();
    }
}
