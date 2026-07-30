use tauri::{async_runtime::spawn_blocking, State};

use crate::models::git::{
    GitCommitDetails, GitCommitDetailsRequest, GitCommitFileDiffRequest, GitCommitRequest,
    GitConflictContent, GitConflictContentRequest, GitDiffResult, GitDiscardResult,
    GitFileComparison, GitFileDiffRequest, GitHistoryActionRequest, GitHistoryPage,
    GitHistoryRequest, GitMutationResult, GitPatchMutationResult, GitPatchRequest, GitPathsRequest,
    GitRemoteOperationRequest, GitRepositoryActionRequest, GitRepositorySnapshot,
    GitRepositorySnapshotRequest, GitResolveConflictRequest, GitRestoreDiscardRequest,
    GitRestorePatchRequest,
};
use crate::services::git_repository_service::GitRepositoryRuntime;

#[tauri::command]
pub async fn get_git_repository_snapshot(
    request: GitRepositorySnapshotRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitRepositorySnapshot, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.snapshot(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn cancel_git_query(
    request_id: String,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<bool, String> {
    runtime.cancel_query(&request_id)
}

#[tauri::command]
pub async fn get_git_file_diff(
    request: GitFileDiffRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitDiffResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.file_diff(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_git_file_comparison(
    request: GitFileDiffRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitFileComparison, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.file_comparison(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn stage_git_paths(
    request: GitPathsRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitMutationResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.stage(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn unstage_git_paths(
    request: GitPathsRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitMutationResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.unstage(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn discard_git_paths(
    request: GitPathsRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitDiscardResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.discard(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn restore_git_discard(
    request: GitRestoreDiscardRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitMutationResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.restore_discard(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn apply_git_partial_patch(
    request: GitPatchRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitPatchMutationResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.apply_partial_patch(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn restore_git_partial_patch(
    request: GitRestorePatchRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitMutationResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.restore_partial_patch(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn commit_git_changes(
    request: GitCommitRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitMutationResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.commit(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn run_git_remote_operation(
    request: GitRemoteOperationRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitMutationResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.remote_operation(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_git_history(
    request: GitHistoryRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitHistoryPage, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || {
        crate::services::git_history_service::load_history(runtime.query_runtime(), &request)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_git_commit_details(
    request: GitCommitDetailsRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitCommitDetails, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || {
        crate::services::git_history_service::load_commit_details(runtime.query_runtime(), &request)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_git_commit_diff(
    request: GitCommitDetailsRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitDiffResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || {
        crate::services::git_history_service::load_commit_diff(runtime.query_runtime(), &request)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_git_commit_file_diff(
    request: GitCommitFileDiffRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitDiffResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || {
        crate::services::git_history_service::load_commit_file_diff(
            runtime.query_runtime(),
            &request,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn run_git_history_action(
    request: GitHistoryActionRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitMutationResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.history_action(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_git_conflict_content(
    request: GitConflictContentRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitConflictContent, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.conflict_content(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn resolve_git_conflict(
    request: GitResolveConflictRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitMutationResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.resolve_conflict(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn run_git_repository_action(
    request: GitRepositoryActionRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitMutationResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.repository_action(&request))
        .await
        .map_err(|error| error.to_string())?
}
