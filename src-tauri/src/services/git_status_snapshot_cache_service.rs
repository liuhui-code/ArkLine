use std::collections::VecDeque;

use crate::services::git_status_service::GitStatusSnapshotSource;

const STATUS_SNAPSHOT_CACHE_BYTES: usize = 48 * 1024 * 1024;
const STATUS_SNAPSHOT_CACHE_ENTRIES: usize = 8;

#[derive(Default)]
pub struct GitStatusSnapshotCache {
    entries: VecDeque<GitStatusSnapshotSource>,
    bytes: usize,
}

impl GitStatusSnapshotCache {
    pub fn get(&mut self, root_path: &str, snapshot_id: &str) -> Option<GitStatusSnapshotSource> {
        let index = self
            .entries
            .iter()
            .position(|entry| entry.matches(root_path, snapshot_id))?;
        let entry = self.entries.remove(index)?;
        let result = entry.clone();
        self.entries.push_back(entry);
        Some(result)
    }

    pub fn insert(&mut self, source: GitStatusSnapshotSource) {
        if source.byte_len() > STATUS_SNAPSHOT_CACHE_BYTES {
            return;
        }
        if let Some(index) = self
            .entries
            .iter()
            .position(|entry| entry.matches(source.request_root(), source.snapshot_id()))
        {
            if let Some(previous) = self.entries.remove(index) {
                self.bytes = self.bytes.saturating_sub(previous.byte_len());
            }
        }
        while self.entries.len() >= STATUS_SNAPSHOT_CACHE_ENTRIES
            || self.bytes + source.byte_len() > STATUS_SNAPSHOT_CACHE_BYTES
        {
            let Some(removed) = self.entries.pop_front() else {
                break;
            };
            self.bytes = self.bytes.saturating_sub(removed.byte_len());
        }
        self.bytes += source.byte_len();
        self.entries.push_back(source);
    }
}
