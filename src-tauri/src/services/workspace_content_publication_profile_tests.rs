use std::fs;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::services::workspace_content_refresh_chunk_service::{
    publish_prepared_workspace_content_core_chunk,
    publish_prepared_workspace_content_substring_chunk,
};
use crate::services::workspace_content_refresh_service::prepare_workspace_content_refresh;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

const PROFILE_FILE_COUNT: usize = 64;
const PROFILE_LINES_PER_FILE: usize = 240;

#[test]
#[ignore = "Run explicitly to profile production content-index publication"]
fn reports_content_publication_write_and_storage_amplification() {
    let root = unique_temp_dir();
    fs::create_dir_all(&root).unwrap();
    let mut paths = Vec::with_capacity(PROFILE_FILE_COUNT);
    let mut source_bytes = 0u64;
    for file_index in 0..PROFILE_FILE_COUNT {
        let path = root.join(format!("File{file_index:03}.ets"));
        let content = (0..PROFILE_LINES_PER_FILE)
            .map(|line| {
                format!(
                    "export const searchableMember{file_index:03}_{line:03} = 'substring-value-{line:03}';"
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        source_bytes += content.len() as u64;
        fs::write(&path, content).unwrap();
        paths.push(path.to_string_lossy().to_string());
    }
    let root_path = root.to_string_lossy().to_string();
    WorkspaceIndexRuntime::default()
        .update_workspace_file_symbol_layer(&root_path, &paths, &[])
        .unwrap();

    let prepared = prepare_workspace_content_refresh(&root_path, &paths, &[], 1);
    let core_started = Instant::now();
    let core_profile =
        publish_prepared_workspace_content_core_chunk(&root_path, &prepared).unwrap();
    let core_elapsed = core_started.elapsed();
    let index_dir = root.join(".arkline/index");
    let core_stored_bytes = stored_bytes(&index_dir);
    let substring_started = Instant::now();
    let substring_profile =
        publish_prepared_workspace_content_substring_chunk(&root_path, &prepared).unwrap();
    let substring_elapsed = substring_started.elapsed();
    let elapsed = core_elapsed + substring_elapsed;
    let indexed_line_count = prepared.files.iter().map(|file| file.line_count).sum::<usize>();
    let indexed_file_count = prepared.files.len();
    let stored_bytes = stored_bytes(&index_dir);
    let amplification = stored_bytes as f64 / source_bytes.max(1) as f64;

    eprintln!(
        "content publication profile: files={}, lines={}, source_bytes={}, core_stored_bytes={}, stored_bytes={}, amplification={:.2}x, core_elapsed={:?}, substring_elapsed={:?}, elapsed={:?}, core_stages={:?}, substring_stages={:?}",
        indexed_file_count,
        indexed_line_count,
        source_bytes,
        core_stored_bytes,
        stored_bytes,
        amplification,
        core_elapsed,
        substring_elapsed,
        elapsed,
        core_profile.stages,
        substring_profile.stages,
    );
    assert_eq!(indexed_file_count, PROFILE_FILE_COUNT);
    assert_eq!(
        indexed_line_count,
        PROFILE_FILE_COUNT * PROFILE_LINES_PER_FILE
    );
    fs::remove_dir_all(root).unwrap();
}

fn stored_bytes(index_dir: &std::path::Path) -> u64 {
    let stored_bytes = fs::read_dir(&index_dir)
        .unwrap()
        .flatten()
        .filter_map(|entry| entry.metadata().ok())
        .map(|metadata| metadata.len())
        .sum::<u64>();
    stored_bytes
}

fn unique_temp_dir() -> std::path::PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-content-publication-profile-{suffix}"))
}
