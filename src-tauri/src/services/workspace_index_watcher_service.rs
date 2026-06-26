use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{recommended_watcher, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_service::normalize_path;
use crate::services::workspace_service::should_exclude;

pub const WORKSPACE_INDEX_CHANGED_EVENT: &str = "workspace-index-changed";

#[derive(Debug, Default)]
pub struct WorkspaceIndexWatcherRuntime {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl WorkspaceIndexWatcherRuntime {
    pub fn watch_workspace_index(
        &self,
        app_handle: AppHandle,
        root_path: &str,
    ) -> Result<(), String> {
        let root = PathBuf::from(root_path);
        let root_key = normalize_path(&root);
        let callback_root = root.clone();
        let callback_root_key = root_key.clone();
        let callback_app = app_handle.clone();
        let mut watcher =
            recommended_watcher(move |event_result: notify::Result<notify::Event>| {
                let Ok(event) = event_result else {
                    return;
                };

                if !should_refresh_workspace_index_for_paths(&callback_root, &event.paths) {
                    return;
                }

                let index_runtime = callback_app.state::<WorkspaceIndexRuntime>();
                let Ok(result) =
                    index_runtime.refresh_workspace_index_with_changes(&callback_root_key)
                else {
                    return;
                };

                if result.changed {
                    let _ = callback_app.emit(WORKSPACE_INDEX_CHANGED_EVENT, result);
                }
            })
            .map_err(|error| error.to_string())?;

        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|error| error.to_string())?;

        self.watchers
            .lock()
            .map_err(|_| "Workspace index watcher lock poisoned".to_string())?
            .insert(root_key, watcher);

        Ok(())
    }

    pub fn unwatch_workspace_index(&self, root_path: &str) -> Result<(), String> {
        let root = PathBuf::from(root_path);
        let root_key = normalize_path(&root);
        self.watchers
            .lock()
            .map_err(|_| "Workspace index watcher lock poisoned".to_string())?
            .remove(&root_key);
        Ok(())
    }
}

pub fn should_refresh_workspace_index_for_paths(root_path: &Path, paths: &[PathBuf]) -> bool {
    paths
        .iter()
        .any(|path| path.starts_with(root_path) && !should_exclude(root_path, path))
}

#[cfg(test)]
mod tests {
    use super::should_refresh_workspace_index_for_paths;
    use std::path::Path;

    #[test]
    fn ignores_index_cache_and_dependency_paths_but_refreshes_source_paths() {
        let root = Path::new("/tmp/ArkDemo");

        assert!(!should_refresh_workspace_index_for_paths(
            root,
            &[Path::new("/tmp/ArkDemo/.arkline/index/workspace-catalog.json").to_path_buf()],
        ));
        assert!(!should_refresh_workspace_index_for_paths(
            root,
            &[Path::new("/tmp/ArkDemo/oh_modules/pkg/index.js").to_path_buf()],
        ));
        assert!(should_refresh_workspace_index_for_paths(
            root,
            &[Path::new("/tmp/ArkDemo/entry/src/main/ets/pages/Index.ets").to_path_buf()],
        ));
    }
}
