use std::fs;
use std::path::Path;

pub(crate) fn plan_content_refresh_chunks(
    root_path: &str,
    changed_paths: &[String],
    removed_paths: &[String],
    path_limit: usize,
    byte_limit: usize,
) -> Vec<(Vec<String>, Vec<String>)> {
    let path_limit = path_limit.max(1);
    let mut chunks = Vec::new();
    let mut changed = Vec::new();
    let mut changed_bytes = 0usize;
    for path in changed_paths {
        let source_bytes = source_size(root_path, path);
        if !changed.is_empty()
            && (changed.len() >= path_limit
                || changed_bytes.saturating_add(source_bytes) > byte_limit)
        {
            chunks.push((std::mem::take(&mut changed), Vec::new()));
            changed_bytes = 0;
        }
        changed.push(path.clone());
        changed_bytes = changed_bytes.saturating_add(source_bytes);
        if changed.len() >= path_limit || changed_bytes >= byte_limit {
            chunks.push((std::mem::take(&mut changed), Vec::new()));
            changed_bytes = 0;
        }
    }
    if !changed.is_empty() {
        chunks.push((changed, Vec::new()));
    }

    let mut removed_offset = 0usize;
    for (changed, removed) in &mut chunks {
        let capacity = path_limit.saturating_sub(changed.len());
        let end = (removed_offset + capacity).min(removed_paths.len());
        removed.extend_from_slice(&removed_paths[removed_offset..end]);
        removed_offset = end;
    }
    while removed_offset < removed_paths.len() {
        let end = (removed_offset + path_limit).min(removed_paths.len());
        chunks.push((Vec::new(), removed_paths[removed_offset..end].to_vec()));
        removed_offset = end;
    }
    chunks
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
    use super::plan_content_refresh_chunks;
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
}
