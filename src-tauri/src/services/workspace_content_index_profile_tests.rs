use std::fs;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::params;

use crate::models::workspace::{WorkspaceTextSearchOptions, WorkspaceTextSearchRequest};
use crate::services::workspace_content_index_service::search_indexed_workspace_content;
use crate::services::workspace_index_connection_service::with_workspace_index_writer;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;

const PROFILE_FILE_COUNT: usize = 100_000;
const PROFILE_SAMPLE_COUNT: usize = 20;
const FIRST_PAGE_TARGET: Duration = Duration::from_millis(150);

#[test]
#[ignore = "Run explicitly to profile a 100k-row persisted content index"]
fn reports_100k_persisted_content_first_page_performance() {
    let root = unique_temp_dir();
    fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();
    seed_content_index(&root_path);
    let request = search_request(&root_path);

    search_indexed_workspace_content(&request).unwrap();
    let mut samples = (0..PROFILE_SAMPLE_COUNT)
        .map(|_| {
            let start = Instant::now();
            let result = search_indexed_workspace_content(&request).unwrap();
            assert_eq!(result.matches.len(), 20);
            start.elapsed()
        })
        .collect::<Vec<_>>();
    samples.sort();
    let p95 = samples[(samples.len() * 95 / 100).min(samples.len() - 1)];
    eprintln!(
        "100k persisted content profile: first_page_p50={:?}, first_page_p95={:?}",
        samples[samples.len() / 2],
        p95
    );
    if strict_perf_enabled() {
        assert!(
            p95 <= FIRST_PAGE_TARGET,
            "100k content first-page p95 {:?} exceeded {:?}",
            p95,
            FIRST_PAGE_TARGET
        );
    }
    fs::remove_dir_all(root).unwrap();
}

fn seed_content_index(root_path: &str) {
    with_workspace_index_writer(root_path, |connection| {
        ensure_workspace_index_schema(connection)?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        {
            let mut line_statement = transaction
                .prepare(
                    "insert into workspace_content_lines
                     (root_path, path, file_id, line, text) values (?1, ?2, ?3, 1, ?4)",
                )
                .map_err(|error| error.to_string())?;
            let mut fts_statement = transaction
                .prepare(
                    "insert into workspace_content_fts
                     (root_path, path, file_id, line, text) values (?1, ?2, ?3, 1, ?4)",
                )
                .map_err(|error| error.to_string())?;
            for index in 0..PROFILE_FILE_COUNT {
                let path = format!("entry\\src\\File{index:06}.ets");
                let text = format!("const CommonSearchNeedle{index:06} = {index};");
                line_statement
                    .execute(params![
                        root_path.replace('/', "\\"),
                        path,
                        index as i64,
                        text
                    ])
                    .map_err(|error| error.to_string())?;
                fts_statement
                    .execute(params![
                        root_path.replace('/', "\\"),
                        path,
                        index as i64,
                        text
                    ])
                    .map_err(|error| error.to_string())?;
            }
        }
        transaction.commit().map_err(|error| error.to_string())
    })
    .unwrap();
}

fn search_request(root_path: &str) -> WorkspaceTextSearchRequest {
    WorkspaceTextSearchRequest {
        root_path: root_path.to_string(),
        query: "CommonSearch".to_string(),
        generation: None,
        cursor: None,
        options: WorkspaceTextSearchOptions {
            case_sensitive: false,
            whole_word: false,
        },
        limit: 20,
        context_lines: 1,
    }
}

fn unique_temp_dir() -> std::path::PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-content-profile-{suffix}"))
}

fn strict_perf_enabled() -> bool {
    std::env::var("ARKLINE_STRICT_PERF")
        .ok()
        .is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}
