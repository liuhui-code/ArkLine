use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct WorkspaceIndexStoreGeneration {
    pub(crate) revision: u64,
    pub(crate) generation: u64,
    pub(crate) active_readers: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceIndexStoreSwapOutcome<T> {
    Applied { value: T, generation: u64 },
    StaleRevision,
    ReadersActive,
}

pub(crate) struct WorkspaceIndexReaderLease {
    store_path: PathBuf,
    generation: u64,
}

impl WorkspaceIndexReaderLease {
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }
}

impl Drop for WorkspaceIndexReaderLease {
    fn drop(&mut self) {
        let Ok(mut stores) = registry().lock() else {
            return;
        };
        if let Some(state) = stores.get_mut(&self.store_path) {
            state.active_readers = state.active_readers.saturating_sub(1);
        }
    }
}

pub(crate) fn acquire_workspace_index_reader(
    store_path: &Path,
) -> Result<WorkspaceIndexReaderLease, String> {
    let mut stores = registry()
        .lock()
        .map_err(|_| "Workspace index store generation registry poisoned".to_string())?;
    let state = stores.entry(store_path.to_path_buf()).or_default();
    state.active_readers = state.active_readers.saturating_add(1);
    Ok(WorkspaceIndexReaderLease {
        store_path: store_path.to_path_buf(),
        generation: state.generation,
    })
}

pub(crate) fn record_workspace_index_write(store_path: &Path) {
    let Ok(mut stores) = registry().lock() else {
        return;
    };
    let state = stores.entry(store_path.to_path_buf()).or_default();
    state.revision = state.revision.saturating_add(1);
}

pub(crate) fn workspace_index_store_generation(store_path: &Path) -> WorkspaceIndexStoreGeneration {
    registry()
        .lock()
        .ok()
        .and_then(|stores| stores.get(store_path).copied())
        .unwrap_or_default()
}

pub(crate) fn with_exclusive_workspace_index_store_swap<T>(
    store_path: &Path,
    expected_revision: u64,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<WorkspaceIndexStoreSwapOutcome<T>, String> {
    let mut stores = registry()
        .lock()
        .map_err(|_| "Workspace index store generation registry poisoned".to_string())?;
    let state = stores.entry(store_path.to_path_buf()).or_default();
    if state.revision != expected_revision {
        return Ok(WorkspaceIndexStoreSwapOutcome::StaleRevision);
    }
    if state.active_readers > 0 {
        return Ok(WorkspaceIndexStoreSwapOutcome::ReadersActive);
    }
    let value = operation()?;
    state.revision = state.revision.saturating_add(1);
    state.generation = state.generation.saturating_add(1);
    Ok(WorkspaceIndexStoreSwapOutcome::Applied {
        value,
        generation: state.generation,
    })
}

#[cfg(test)]
pub(crate) fn clear_workspace_index_store_generation(store_path: &Path) {
    if let Ok(mut stores) = registry().lock() {
        stores.remove(store_path);
    }
}

fn registry() -> &'static Mutex<HashMap<PathBuf, WorkspaceIndexStoreGeneration>> {
    static REGISTRY: OnceLock<Mutex<HashMap<PathBuf, WorkspaceIndexStoreGeneration>>> =
        OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(test)]
mod tests {
    use super::{
        acquire_workspace_index_reader, clear_workspace_index_store_generation,
        record_workspace_index_write, with_exclusive_workspace_index_store_swap,
        workspace_index_store_generation, WorkspaceIndexStoreSwapOutcome,
    };

    #[test]
    fn swap_requires_the_expected_revision_and_no_active_readers() {
        let path = std::env::temp_dir().join(format!(
            "arkline-store-generation-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        record_workspace_index_write(&path);
        let lease = acquire_workspace_index_reader(&path).unwrap();

        assert_eq!(
            with_exclusive_workspace_index_store_swap(&path, 1, || Ok(())).unwrap(),
            WorkspaceIndexStoreSwapOutcome::ReadersActive
        );
        drop(lease);
        record_workspace_index_write(&path);
        assert_eq!(
            with_exclusive_workspace_index_store_swap(&path, 1, || Ok(())).unwrap(),
            WorkspaceIndexStoreSwapOutcome::StaleRevision
        );
        assert!(matches!(
            with_exclusive_workspace_index_store_swap(&path, 2, || Ok("swapped")).unwrap(),
            WorkspaceIndexStoreSwapOutcome::Applied {
                value: "swapped",
                generation: 1
            }
        ));
        assert_eq!(workspace_index_store_generation(&path).revision, 3);
        clear_workspace_index_store_generation(&path);
    }
}
