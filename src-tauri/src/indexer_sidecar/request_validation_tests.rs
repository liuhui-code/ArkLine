use super::protocol::{IndexerContentRefreshRequest, IndexerTaskKey};
use super::request_validation::validate_content_refresh_request;

fn request(changed_paths: Vec<String>, removed_paths: Vec<String>) -> IndexerContentRefreshRequest {
    IndexerContentRefreshRequest {
        task: IndexerTaskKey {
            root_path: "/workspace".to_string(),
            kind: "content-refresh".to_string(),
            generation: 7,
            reason: "test".to_string(),
        },
        indexed_generation: 10,
        changed_paths,
        removed_paths,
        priority: "background".to_string(),
    }
}

#[test]
fn content_refresh_rejects_more_than_one_bounded_chunk() {
    let paths = (0..65)
        .map(|index| format!("/workspace/File{index}.ets"))
        .collect();

    let error = validate_content_refresh_request(&request(paths, Vec::new())).unwrap_err();

    assert!(error.contains("between 1 and 64"));
}

#[test]
fn content_refresh_rejects_duplicates_across_changed_and_removed_paths() {
    let path = "/workspace/Entry.ets".to_string();

    let error =
        validate_content_refresh_request(&request(vec![path.clone()], vec![path])).unwrap_err();

    assert!(error.contains("duplicate path"));
}

#[test]
fn content_refresh_rejects_lexical_paths_outside_the_workspace() {
    let error = validate_content_refresh_request(&request(
        vec!["/workspace/../outside/Entry.ets".to_string()],
        Vec::new(),
    ))
    .unwrap_err();

    assert!(error.contains("outside workspace root"));
}
