use crate::models::language::{GitBlameResponse, GitCommitTraceResponse};
use crate::services::git_command_service::{load_commit_trace_blocking, load_file_blame_blocking};

#[tauri::command]
pub async fn get_file_blame(path: String) -> Result<GitBlameResponse, String> {
    load_file_blame_blocking(path).await
}

#[tauri::command]
pub async fn get_commit_trace(
    path: String,
    commit: String,
    line: usize,
) -> Result<GitCommitTraceResponse, String> {
    load_commit_trace_blocking(path, commit, line).await
}
