use tauri::{async_runtime::spawn_blocking, State};

use crate::models::git::{GitBranchSnapshot, GitCheckoutBranchRequest, GitCheckoutBranchResult};
use crate::services::git_branch_service::checkout_branch;
use crate::services::git_repository_service::GitRepositoryRuntime;

#[tauri::command]
pub async fn list_git_branches(
    root_path: String,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitBranchSnapshot, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || runtime.branches(&root_path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn checkout_git_branch(
    request: GitCheckoutBranchRequest,
    runtime: State<'_, GitRepositoryRuntime>,
) -> Result<GitCheckoutBranchResult, String> {
    let runtime = runtime.inner().clone();
    spawn_blocking(move || {
        runtime.with_repository_lock(&request.root_path, |_| checkout_branch(&request))
    })
    .await
    .map_err(|error| error.to_string())?
}
