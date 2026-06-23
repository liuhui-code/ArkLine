use std::env;
use std::path::{Path, PathBuf};

pub const HARMONY_SDK_PATH_ENV: &str = "ARKLINE_HARMONY_SDK_PATH";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SdkDiscovery {
    Ready(PathBuf),
    Missing,
}

pub fn discover_harmony_sdk(configured: Option<&str>) -> SdkDiscovery {
    match configured {
        Some(value) if !value.trim().is_empty() => discover_from_configured(Some(value))
            .map_or(SdkDiscovery::Missing, SdkDiscovery::Ready),
        _ => discover_from_candidates(default_sdk_candidates(env::consts::OS))
            .map_or(SdkDiscovery::Missing, SdkDiscovery::Ready),
    }
}

pub fn default_sdk_candidates(platform: &str) -> Vec<PathBuf> {
    match platform {
        "macos" => vec![
            PathBuf::from("/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony"),
            PathBuf::from("/Applications/DevEco Studio.app/Contents/sdk/default/openharmony"),
            PathBuf::from("/Users/liuhui/Library/Huawei/Sdk/default/openharmony"),
        ],
        _ => Vec::new(),
    }
}

fn discover_from_configured(configured: Option<&str>) -> Option<PathBuf> {
    configured
        .filter(|value| !value.trim().is_empty())
        .map(Path::new)
        .filter(|path| is_valid_sdk_root(path))
        .map(Path::to_path_buf)
}

fn discover_from_candidates(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|path| is_valid_sdk_root(path))
}

fn is_valid_sdk_root(path: &Path) -> bool {
    path.exists() && path.is_dir() && path.join("ets").is_dir() && path.join("toolchains").is_dir()
}

pub fn discover_harmony_sdk_from_env() -> SdkDiscovery {
    discover_harmony_sdk(env::var(HARMONY_SDK_PATH_ENV).ok().as_deref())
}

#[cfg(test)]
mod tests {
    use super::{default_sdk_candidates, discover_harmony_sdk, HARMONY_SDK_PATH_ENV, SdkDiscovery};

    #[test]
    fn reports_missing_sdk_without_crashing() {
        let discovery = discover_harmony_sdk(Some("/tmp/arkline-missing-sdk"));
        assert_eq!(discovery, SdkDiscovery::Missing);
    }

    #[test]
    fn exposes_the_configured_sdk_env_name() {
        assert_eq!(HARMONY_SDK_PATH_ENV, "ARKLINE_HARMONY_SDK_PATH");
    }

    #[test]
    fn includes_deveco_default_sdk_candidate_on_macos() {
        let candidates = default_sdk_candidates("macos");

        assert!(candidates.iter().any(|path| {
            path.to_string_lossy()
                .contains("DevEco-Studio.app/Contents/sdk/default/openharmony")
        }));
    }
}
