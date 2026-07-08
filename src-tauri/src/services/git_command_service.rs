use std::path::PathBuf;

use tauri::async_runtime::spawn_blocking;

use crate::models::language::{GitBlameResponse, GitCommitTraceResponse};
use crate::services::git_trace_service::{load_commit_trace, load_file_blame};

pub async fn load_file_blame_blocking(path: String) -> Result<GitBlameResponse, String> {
    spawn_blocking(move || load_file_blame(&PathBuf::from(path)))
        .await
        .map_err(|error| error.to_string())?
}

pub async fn load_commit_trace_blocking(
    path: String,
    commit: String,
    line: usize,
) -> Result<GitCommitTraceResponse, String> {
    spawn_blocking(move || load_commit_trace(&PathBuf::from(path), &commit, line))
        .await
        .map_err(|error| error.to_string())?
}
