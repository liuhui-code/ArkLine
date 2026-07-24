use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use crate::services::workspace_discovery_store_service::{
    load_ready_discovered_files, load_ready_discovery_generation,
};

const CACHED_WORKSPACE_LIMIT: usize = 8;

struct CachedSearchPaths {
    generation: i64,
    paths: Arc<Vec<String>>,
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
    let key = normalize_path(root_path);
    if let Some(paths) = cached_paths(&key, generation) {
        return Ok(Some(paths));
    }
    let Some(paths) = load_ready_discovered_files(root_path, limit)? else {
        return Ok(None);
    };
    let paths = Arc::new(paths);
    store_paths(key, generation, Arc::clone(&paths));
    Ok(Some(paths))
}

fn cached_paths(key: &str, generation: i64) -> Option<Arc<Vec<String>>> {
    search_path_cache().lock().ok().and_then(|cache| {
        cache
            .entries
            .get(key)
            .filter(|entry| entry.generation == generation)
            .map(|entry| Arc::clone(&entry.paths))
    })
}

fn store_paths(key: String, generation: i64, paths: Arc<Vec<String>>) {
    let Ok(mut cache) = search_path_cache().lock() else {
        return;
    };
    if !cache.entries.contains_key(&key) && cache.entries.len() >= CACHED_WORKSPACE_LIMIT {
        if let Some(expired) = cache.entries.keys().next().cloned() {
            cache.entries.remove(&expired);
        }
    }
    cache
        .entries
        .insert(key, CachedSearchPaths { generation, paths });
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
