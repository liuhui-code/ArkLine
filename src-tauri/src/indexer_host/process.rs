use std::env;
use std::path::PathBuf;

pub const ARKLINE_INDEXER_PATH_ENV: &str = "ARKLINE_INDEXER_PATH";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexerHostDiscovery {
    pub executable_path: Option<PathBuf>,
    pub detail: String,
}

pub fn discover_indexer_executable() -> IndexerHostDiscovery {
    if let Some(configured) = env::var_os(ARKLINE_INDEXER_PATH_ENV) {
        return discovery_for_path(PathBuf::from(configured), "configured");
    }
    let Some(candidate) = sibling_indexer_candidate() else {
        return IndexerHostDiscovery {
            executable_path: None,
            detail: "Indexer executable could not be resolved beside the current process"
                .to_string(),
        };
    };
    discovery_for_path(candidate, "sibling")
}

fn discovery_for_path(path: PathBuf, source: &str) -> IndexerHostDiscovery {
    if path.is_file() {
        return IndexerHostDiscovery {
            detail: format!("Indexer {source} executable ready at {}", path.display()),
            executable_path: Some(path),
        };
    }
    IndexerHostDiscovery {
        executable_path: None,
        detail: format!(
            "Indexer {source} executable is missing at {}",
            path.display()
        ),
    }
}

fn sibling_indexer_candidate() -> Option<PathBuf> {
    let executable = env::current_exe().ok()?;
    let mut directory = executable.parent()?;
    if directory.file_name().is_some_and(|name| name == "deps") {
        directory = directory.parent()?;
    }
    Some(directory.join(indexer_executable_name()))
}

fn indexer_executable_name() -> &'static str {
    if cfg!(windows) {
        "arkline-indexer.exe"
    } else {
        "arkline-indexer"
    }
}

#[cfg(test)]
mod tests {
    use super::indexer_executable_name;

    #[test]
    fn indexer_name_matches_the_target_platform() {
        assert_eq!(indexer_executable_name().ends_with(".exe"), cfg!(windows));
    }
}
