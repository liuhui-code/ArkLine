use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{recommended_watcher, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
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

                let changed_paths = workspace_index_changed_paths_for_event(
                    &callback_root,
                    &event.kind,
                    &event.paths,
                );
                if changed_paths.is_empty() {
                    return;
                }

                let index_manager = callback_app.state::<WorkspaceIndexManagerRuntime>();
                if index_manager
                    .schedule_changed_paths(&callback_root_key, &changed_paths)
                    .is_err()
                {
                    return;
                }
                let index_runtime = callback_app.state::<WorkspaceIndexRuntime>();
                let Ok(results) = index_manager.drain_index_tasks(&index_runtime) else {
                    return;
                };

                for result in results {
                    if result.changed {
                        let _ = callback_app.emit(WORKSPACE_INDEX_CHANGED_EVENT, result);
                    }
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
    !workspace_index_changed_paths_for_event(root_path, &EventKind::Any, paths).is_empty()
}

pub fn workspace_index_changed_paths_for_event(
    root_path: &Path,
    event_kind: &EventKind,
    paths: &[PathBuf],
) -> Vec<String> {
    if matches!(event_kind, EventKind::Access(_) | EventKind::Other) {
        return Vec::new();
    }

    let mut changed_paths = paths
        .iter()
        .filter(|path| is_workspace_file_event_path(root_path, path))
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    changed_paths.sort();
    changed_paths.dedup();
    changed_paths
}

fn is_workspace_file_event_path(root_path: &Path, path: &Path) -> bool {
    let Ok(relative_path) = path.strip_prefix(root_path) else {
        return false;
    };
    if relative_path.as_os_str().is_empty() || should_exclude(root_path, path) {
        return false;
    }

    !path.is_dir()
}

#[cfg(test)]
mod tests {
    use super::{
        should_refresh_workspace_index_for_paths, workspace_index_changed_paths_for_event,
    };
    use notify::event::AccessKind;
    use notify::EventKind;
    use std::fs;
    use std::path::{Path, PathBuf};

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

    #[test]
    fn ignores_root_path_mixed_with_index_cache_writes() {
        let root = Path::new("/tmp/ArkDemo");
        let paths = vec![
            root.to_path_buf(),
            root.join(".arkline/index/workspace-catalog.sqlite-wal"),
        ];

        assert!(workspace_index_changed_paths_for_event(root, &EventKind::Any, &paths).is_empty());
    }

    #[test]
    fn retains_only_source_path_from_mixed_event() {
        let root = Path::new("/tmp/ArkDemo");
        let source = root.join("entry/src/main/ets/pages/Index.ets");
        let paths = vec![
            root.to_path_buf(),
            root.join(".arkline/index/workspace-catalog.sqlite"),
            source.clone(),
        ];

        assert_eq!(
            workspace_index_changed_paths_for_event(root, &EventKind::Any, &paths),
            vec![source.to_string_lossy().to_string()]
        );
    }

    #[test]
    fn ignores_access_events_and_existing_directories() {
        let root = unique_temp_root("watcher-filter");
        let source_dir = root.join("entry");
        let source = source_dir.join("Index.ets");
        fs::create_dir_all(&source_dir).unwrap();
        fs::write(&source, "struct Index {}\n").unwrap();

        assert!(workspace_index_changed_paths_for_event(
            &root,
            &EventKind::Access(AccessKind::Any),
            &[source],
        )
        .is_empty());
        assert!(
            workspace_index_changed_paths_for_event(&root, &EventKind::Any, &[source_dir],)
                .is_empty()
        );

        fs::remove_dir_all(root).unwrap();
    }

    fn unique_temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "arkline-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}
