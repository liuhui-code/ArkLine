use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceRefreshChunk {
    pub(crate) changed_paths: Vec<String>,
    pub(crate) removed_paths: Vec<String>,
    pub(crate) changed_source_bytes: usize,
    pub(crate) next_changed_offset: usize,
    pub(crate) next_removed_offset: usize,
}

#[cfg(test)]
pub(crate) fn plan_content_refresh_chunks(
    root_path: &str,
    changed_paths: &[String],
    removed_paths: &[String],
    path_limit: usize,
    byte_limit: usize,
) -> Vec<(Vec<String>, Vec<String>)> {
    let mut chunks = Vec::new();
    let mut changed_offset = 0usize;
    let mut removed_offset = 0usize;
    while let Some(chunk) = take_refresh_chunk(
        root_path,
        changed_paths,
        removed_paths,
        changed_offset,
        removed_offset,
        path_limit,
        byte_limit,
    ) {
        changed_offset = chunk.next_changed_offset;
        removed_offset = chunk.next_removed_offset;
        chunks.push((chunk.changed_paths, chunk.removed_paths));
    }
    chunks
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn take_refresh_chunk(
    root_path: &str,
    changed_paths: &[String],
    removed_paths: &[String],
    changed_offset: usize,
    removed_offset: usize,
    path_limit: usize,
    byte_limit: usize,
) -> Option<WorkspaceRefreshChunk> {
    if changed_offset >= changed_paths.len() && removed_offset >= removed_paths.len() {
        return None;
    }
    let path_limit = path_limit.max(1);
    let byte_limit = byte_limit.max(1);
    let mut next_changed_offset = changed_offset;
    let mut changed_source_bytes = 0usize;
    while next_changed_offset < changed_paths.len()
        && next_changed_offset - changed_offset < path_limit
    {
        let candidate_bytes = source_size(root_path, &changed_paths[next_changed_offset]);
        if next_changed_offset > changed_offset
            && changed_source_bytes.saturating_add(candidate_bytes) > byte_limit
        {
            break;
        }
        changed_source_bytes = changed_source_bytes.saturating_add(candidate_bytes);
        next_changed_offset += 1;
        if changed_source_bytes >= byte_limit {
            break;
        }
    }
    let changed_count = next_changed_offset - changed_offset;
    let removed_capacity = path_limit.saturating_sub(changed_count);
    let next_removed_offset = removed_offset
        .saturating_add(removed_capacity)
        .min(removed_paths.len());
    Some(WorkspaceRefreshChunk {
        changed_paths: changed_paths[changed_offset..next_changed_offset].to_vec(),
        removed_paths: removed_paths[removed_offset..next_removed_offset].to_vec(),
        changed_source_bytes,
        next_changed_offset,
        next_removed_offset,
    })
}

fn source_size(root_path: &str, path: &str) -> usize {
    let filesystem_path = if root_path.contains('/') {
        path.replace('\\', "/")
    } else {
        path.replace('/', "\\")
    };
    fs::metadata(Path::new(&filesystem_path))
        .ok()
        .and_then(|metadata| usize::try_from(metadata.len()).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{plan_content_refresh_chunks, take_refresh_chunk};
    use std::fs;

    #[test]
    fn planner_respects_path_and_source_byte_limits() {
        let root = std::env::temp_dir().join(format!(
            "arkline-content-chunk-plan-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let paths = (0..3)
            .map(|index| {
                let path = root.join(format!("File{index}.ets"));
                fs::write(&path, "123456").unwrap();
                path.to_string_lossy().to_string()
            })
            .collect::<Vec<_>>();
        let removed = vec![root.join("Old.ets").to_string_lossy().to_string()];

        let chunks = plan_content_refresh_chunks(&root.to_string_lossy(), &paths, &removed, 2, 10);

        assert_eq!(chunks.len(), 3);
        assert!(chunks
            .iter()
            .all(|(changed, removed)| changed.len() + removed.len() <= 2));
        assert!(chunks.iter().all(|(changed, _)| changed.len() == 1));
        assert_eq!(chunks.iter().map(|chunk| chunk.0.len()).sum::<usize>(), 3);
        assert_eq!(chunks.iter().map(|chunk| chunk.1.len()).sum::<usize>(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn next_chunk_resumes_from_offsets_with_new_limits() {
        let changed = (0..5)
            .map(|index| format!("/root/{index}.ets"))
            .collect::<Vec<_>>();
        let removed = vec!["/root/old.ets".to_string()];

        let first = take_refresh_chunk("/root", &changed, &removed, 0, 0, 3, 10).unwrap();
        let second = take_refresh_chunk(
            "/root",
            &changed,
            &removed,
            first.next_changed_offset,
            first.next_removed_offset,
            1,
            10,
        )
        .unwrap();

        assert_eq!(first.changed_paths.len(), 3);
        assert_eq!(second.changed_paths, vec!["/root/3.ets"]);
        assert!(second.removed_paths.is_empty());
    }
}
