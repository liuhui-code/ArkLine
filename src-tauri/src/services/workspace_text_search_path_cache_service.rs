use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::services::workspace_discovery_service::discover_workspace_chunk;
use crate::services::workspace_discovery_store_service::{
    load_ready_discovery_generation, load_ready_searchable_discovered_files,
};
use crate::services::workspace_file_fingerprint_service::workspace_file_policy_revision;

const CACHED_WORKSPACE_LIMIT: usize = 8;
const TRANSIENT_SNAPSHOT_TTL: Duration = Duration::from_secs(2);

struct CachedSearchPaths {
    revision: String,
    paths: Arc<Vec<String>>,
    expires_at: Option<Instant>,
}

#[derive(Default)]
struct SearchPathCache {
    entries: HashMap<String, CachedSearchPaths>,
}

pub(crate) fn cached_ready_discovered_paths(
    root_path: &str,
    limit: usize,
) -> Result<Option<Arc<Vec<String>>>, String> {
    let Some(generation) = load_ready_discovery_generation(root_path)? else {
        return Ok(None);
    };
    let revision = format!("{generation}:{}", workspace_file_policy_revision(root_path));
    let key = normalize_path(root_path);
    if let Some(paths) = cached_paths(&key, &revision) {
        return Ok(Some(paths));
    }
    let paths = load_ready_searchable_discovered_files(root_path, limit)?;
    let paths = Arc::new(paths);
    store_paths(key, revision, Arc::clone(&paths), None);
    Ok(Some(paths))
}

pub(crate) fn cached_searchable_workspace_paths(
    root_path: &str,
    limit: usize,
) -> Result<Arc<Vec<String>>, String> {
    if let Some(paths) = cached_ready_discovered_paths(root_path, limit)? {
        return Ok(paths);
    }

    let key = normalize_path(root_path);
    let revision = format!("transient:{}", workspace_file_policy_revision(root_path));
    if let Some(paths) = cached_paths(&key, &revision) {
        return Ok(paths);
    }

    // Discovery publishes incrementally. A search must not turn the unpublished
    // tail into a false "No matches" result while that publication is in flight.
    let paths = discover_workspace_chunk(Path::new(root_path), None, limit)?
        .files
        .into_iter()
        .map(|file| file.path)
        .collect::<Vec<_>>();
    let paths = Arc::new(paths);
    store_paths(
        key,
        revision,
        Arc::clone(&paths),
        Some(Instant::now() + TRANSIENT_SNAPSHOT_TTL),
    );
    Ok(paths)
}

fn cached_paths(key: &str, revision: &str) -> Option<Arc<Vec<String>>> {
    search_path_cache().lock().ok().and_then(|cache| {
        cache
            .entries
            .get(key)
            .filter(|entry| {
                entry.revision == revision
                    && entry
                        .expires_at
                        .is_none_or(|expires_at| expires_at > Instant::now())
            })
            .map(|entry| Arc::clone(&entry.paths))
    })
}

fn store_paths(
    key: String,
    revision: String,
    paths: Arc<Vec<String>>,
    expires_at: Option<Instant>,
) {
    let Ok(mut cache) = search_path_cache().lock() else {
        return;
    };
    if !cache.entries.contains_key(&key) && cache.entries.len() >= CACHED_WORKSPACE_LIMIT {
        if let Some(expired) = cache.entries.keys().next().cloned() {
            cache.entries.remove(&expired);
        }
    }
    cache.entries.insert(
        key,
        CachedSearchPaths {
            revision,
            paths,
            expires_at,
        },
    );
}

fn search_path_cache() -> &'static Mutex<SearchPathCache> {
    static CACHE: OnceLock<Mutex<SearchPathCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(SearchPathCache::default()))
}

fn normalize_path(path: &str) -> String {
    path.replace('/', "\\")
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::cached_ready_discovered_paths;
    use crate::services::workspace_discovery_service::WorkspaceDiscoveredFile;
    use crate::services::workspace_discovery_store_service::{
        replace_discovered_file_chunk, update_discovery_state, WorkspaceDiscoveryState,
    };
    use crate::services::workspace_file_fingerprint_service::update_file_catalog_fingerprints;

    #[test]
    fn cache_refreshes_when_discovery_generation_changes() {
        let root = std::env::temp_dir().join(format!(
            "arkline-search-path-cache-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let root_path = root.to_string_lossy().to_string();
        publish(&root_path, 1, &["entry\\A.ets"]);
        let first = cached_ready_discovered_paths(&root_path, 10)
            .unwrap()
            .unwrap();
        assert_eq!(first.as_slice(), ["entry\\A.ets"]);

        publish(&root_path, 2, &["entry\\B.ets"]);
        let second = cached_ready_discovered_paths(&root_path, 10)
            .unwrap()
            .unwrap();
        assert_eq!(second.as_slice(), ["entry\\A.ets", "entry\\B.ets"]);
        assert!(!Arc::ptr_eq(&first, &second));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cache_excludes_files_disabled_by_persisted_content_policy() {
        let root = std::env::temp_dir().join(format!(
            "arkline-search-path-policy-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let binary = root.join("payload.bin");
        fs::write(&binary, b"text\0binary").unwrap();
        let root_path = root.to_string_lossy().to_string();
        let binary_path = binary.to_string_lossy().to_string();
        publish(&root_path, 1, &[&binary_path]);
        let unclassified = cached_ready_discovered_paths(&root_path, 10)
            .unwrap()
            .unwrap();
        assert_eq!(unclassified.len(), 1);
        update_file_catalog_fingerprints(&root_path, &[binary_path], 1).unwrap();

        let paths = cached_ready_discovered_paths(&root_path, 10)
            .unwrap()
            .unwrap();

        assert!(paths.is_empty());
        assert!(!Arc::ptr_eq(&unclassified, &paths));
        fs::remove_dir_all(root).unwrap();
    }

    fn publish(root_path: &str, generation: i64, paths: &[&str]) {
        let files = paths
            .iter()
            .map(|path| WorkspaceDiscoveredFile {
                path: (*path).to_string(),
                size_bytes: 1,
                modified_ms: None,
            })
            .collect::<Vec<_>>();
        replace_discovered_file_chunk(root_path, generation, &files).unwrap();
        update_discovery_state(&WorkspaceDiscoveryState {
            root_path: root_path.to_string(),
            generation,
            status: "ready".to_string(),
            discovered_count: paths.len(),
            excluded_count: 0,
            cursor: None,
            error: None,
        })
        .unwrap();
    }
}
