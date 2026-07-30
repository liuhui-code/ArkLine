use tauri::{async_runtime::spawn_blocking, State};

use crate::models::git::{
    GitDiffResult, GitMutationResult, GitStashActionRequest, GitStashCreateRequest,
    GitStashDiffRequest, GitStashListRequest, GitStashPage,
};
use crate::services::git_repository_service::GitRepositoryRuntime;

#[tauri::command]
pub async fn get_git_stashes(
    request: GitStashListRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitStashPage, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.stashes(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn create_git_stash(
    request: GitStashCreateRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitMutationResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.create_stash(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn run_git_stash_action(
    request: GitStashActionRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitMutationResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.stash_action(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_git_stash_diff(
    request: GitStashDiffRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitDiffResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.stash_diff(&request))
        .await
        .map_err(|error| error.to_string())?
}
