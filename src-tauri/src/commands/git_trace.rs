use crate::models::language::{GitBlameResponse, GitCommitTraceResponse};
use crate::services::git_trace_service::{load_commit_trace, load_file_blame};

#[tauri::command]
pub fn get_file_blame(path: String) -> Result<GitBlameResponse, String> {
    load_file_blame(path.as_ref())
}

#[tauri::command]
pub fn get_commit_trace(
    path: String,
    commit: String,
    line: usize,
) -> Result<GitCommitTraceResponse, String> {
    load_commit_trace(path.as_ref(), &commit, line)
}
