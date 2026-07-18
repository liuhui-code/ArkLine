use std::env;
use std::path::{Path, PathBuf};

const SHARED_SDK_INDEX_DIR_ENV: &str = "ARKLINE_SHARED_SDK_INDEX_DIR";

pub fn shared_sdk_store_path(root_path: &str) -> Result<PathBuf, String> {
    if let Some(configured) =
        env::var_os(SHARED_SDK_INDEX_DIR_ENV).filter(|value| !value.is_empty())
    {
        return Ok(store_path_under(Path::new(&configured)));
    }

    #[cfg(test)]
    {
        return Ok(Path::new(root_path)
            .join(".arkline")
            .join("index")
            .join("shared-sdk-artifacts.sqlite"));
    }

    #[cfg(not(test))]
    platform_cache_root()
        .map(|root| store_path_under(&root))
        .ok_or_else(|| "Unable to resolve the ArkLine shared SDK index directory".to_string())
}

fn store_path_under(root: &Path) -> PathBuf {
    root.join("sdk-index")
        .join("v1")
        .join("shared-sdk-artifacts.sqlite")
}

#[cfg(all(not(test), target_os = "windows"))]
fn platform_cache_root() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|root| root.join("ArkLine"))
}

#[cfg(all(not(test), target_os = "macos"))]
fn platform_cache_root() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .map(|root| root.join("Library").join("Caches").join("ArkLine"))
}

#[cfg(all(not(test), not(any(target_os = "windows", target_os = "macos"))))]
fn platform_cache_root() -> Option<PathBuf> {
    env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME")
                .map(PathBuf::from)
                .map(|root| root.join(".cache"))
        })
        .map(|root| root.join("arkline"))
}
