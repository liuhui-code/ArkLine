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
        Some(value) if !value.trim().is_empty() => {
            discover_from_configured(Some(value)).map_or(SdkDiscovery::Missing, SdkDiscovery::Ready)
        }
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
        .map(configured_sdk_candidates)
        .into_iter()
        .flatten()
        .find(|path| is_valid_sdk_root(path))
}

fn discover_from_candidates(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|path| is_valid_sdk_root(path))
}

fn is_valid_sdk_root(path: &Path) -> bool {
    path.exists() && path.is_dir() && path.join("ets").is_dir() && path.join("toolchains").is_dir()
}

fn configured_sdk_candidates(configured: &str) -> Vec<PathBuf> {
    let root = PathBuf::from(configured.trim());
    vec![
        root.clone(),
        root.join("openharmony"),
        root.join("default").join("openharmony"),
    ]
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{default_sdk_candidates, discover_harmony_sdk, SdkDiscovery, HARMONY_SDK_PATH_ENV};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-sdk-discovery-{name}-{suffix}"))
    }

    fn create_nested_sdk_fixture(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let root = unique_temp_dir(name);
        let sdk_parent = root.join("sdk");
        let sdk_default = sdk_parent.join("default");
        let openharmony = sdk_default.join("openharmony");
        fs::create_dir_all(openharmony.join("ets")).unwrap();
        fs::create_dir_all(openharmony.join("toolchains")).unwrap();

        (sdk_parent, sdk_default, openharmony)
    }

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

    #[test]
    fn accepts_deveco_sdk_parent_directory() {
        let (sdk_parent, _sdk_default, openharmony) = create_nested_sdk_fixture("parent");

        let discovery = discover_harmony_sdk(Some(sdk_parent.to_string_lossy().as_ref()));

        assert_eq!(discovery, SdkDiscovery::Ready(openharmony));
        fs::remove_dir_all(sdk_parent.parent().unwrap()).unwrap();
    }

    #[test]
    fn accepts_deveco_default_directory() {
        let (sdk_parent, sdk_default, openharmony) = create_nested_sdk_fixture("default");

        let discovery = discover_harmony_sdk(Some(sdk_default.to_string_lossy().as_ref()));

        assert_eq!(discovery, SdkDiscovery::Ready(openharmony));
        fs::remove_dir_all(sdk_parent.parent().unwrap()).unwrap();
    }
}
