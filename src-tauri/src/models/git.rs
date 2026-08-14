use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub display_name: String,
    pub kind: String,
    pub current: bool,
    pub favorite: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkingTreeState {
    pub dirty: bool,
    pub changed_files: usize,
    pub conflicted_files: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchSnapshot {
    pub root_path: String,
    pub current_branch: Option<String>,
    pub detached: bool,
    pub local_branches: Vec<GitBranch>,
    pub remote_branches: Vec<GitBranch>,
    pub recent_branches: Vec<String>,
    pub working_tree: GitWorkingTreeState,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckoutBranchRequest {
    pub root_path: String,
    pub name: String,
    pub kind: String,
    pub strategy: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckoutBranchResult {
    pub snapshot: GitBranchSnapshot,
    pub message: String,
    pub stash_restored: bool,
    pub stash_kept: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeEntry {
    pub relative_path: String,
    pub absolute_path: String,
    pub original_path: Option<String>,
    pub status_code: String,
    pub kind: String,
    pub staged: bool,
    pub unstaged: bool,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositorySnapshot {
    pub root_path: String,
    pub repository_root: String,
    pub current_branch: Option<String>,
    pub detached: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub operation: String,
    pub generation: u64,
    pub snapshot_id: String,
    pub total_changes: usize,
    pub staged_changes: usize,
    pub conflicted_changes: usize,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub changes: Vec<GitChangeEntry>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositorySnapshotRequest {
    pub root_path: String,
    pub cursor: Option<String>,
    pub limit: u32,
    pub request_id: String,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiffRequest {
    pub root_path: String,
    pub relative_path: String,
    #[serde(default)]
    pub original_path: Option<String>,
    pub staged: bool,
    #[serde(default)]
    pub scope: Option<String>,
    pub request_id: String,
    pub timeout_ms: u64,
    pub max_bytes: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub content: String,
    pub truncated: bool,
    pub total_bytes: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffDocument {
    pub exists: bool,
    pub binary: bool,
    pub content: Option<String>,
    pub truncated: bool,
    pub total_bytes: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileComparison {
    pub relative_path: String,
    pub staged: bool,
    pub before: GitDiffDocument,
    pub after: GitDiffDocument,
    pub patch: GitDiffResult,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPathsRequest {
    pub root_path: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRequest {
    pub root_path: String,
    pub message: String,
    pub amend: bool,
    pub sign_off: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteOperationRequest {
    pub root_path: String,
    pub operation: String,
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPushPreviewRequest {
    pub root_path: String,
    pub request_id: String,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPushPreview {
    pub root_path: String,
    pub repository_root: String,
    pub local_branch: String,
    pub remote: String,
    pub remote_branch: String,
    pub has_upstream: bool,
    pub total_commits: usize,
    pub commits_truncated: bool,
    pub commits: Vec<GitCommitSummary>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitMutationResult {
    pub message: String,
    pub snapshot: GitRepositorySnapshot,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitDiscardResult {
    pub message: String,
    pub backup_commit: String,
    pub snapshot: GitRepositorySnapshot,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRestoreDiscardRequest {
    pub root_path: String,
    pub backup_commit: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPatchRequest {
    pub root_path: String,
    pub relative_path: String,
    pub patch: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPatchMutationResult {
    pub message: String,
    pub backup_commit: Option<String>,
    pub snapshot: GitRepositorySnapshot,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRestorePatchRequest {
    pub root_path: String,
    pub relative_path: String,
    pub patch: String,
    pub backup_commit: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryRequest {
    pub root_path: String,
    #[serde(default)]
    pub ref_name: Option<String>,
    pub cursor: Option<String>,
    pub limit: u32,
    pub request_id: String,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitSummary {
    pub commit: String,
    pub short_commit: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub subject: String,
    pub author: String,
    pub author_email: String,
    pub authored_at_epoch_seconds: i64,
    pub graph: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryPage {
    pub commits: Vec<GitCommitSummary>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetailsRequest {
    pub root_path: String,
    pub commit: String,
    pub request_id: String,
    pub timeout_ms: u64,
    pub max_diff_bytes: usize,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFileDiffRequest {
    pub root_path: String,
    pub commit: String,
    pub relative_path: String,
    pub previous_path: Option<String>,
    pub request_id: String,
    pub timeout_ms: u64,
    pub max_diff_bytes: usize,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryActionRequest {
    pub root_path: String,
    pub commit: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFile {
    pub status: String,
    pub path: String,
    pub previous_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetails {
    pub commit: String,
    pub short_commit: String,
    pub parents: Vec<String>,
    pub author: String,
    pub author_email: String,
    pub authored_at_epoch_seconds: i64,
    pub subject: String,
    pub body: String,
    pub files: Vec<GitCommitFile>,
    pub files_truncated: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictContentRequest {
    pub root_path: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictVersion {
    pub exists: bool,
    pub binary: bool,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictContent {
    pub relative_path: String,
    pub base: GitConflictVersion,
    pub current: GitConflictVersion,
    pub incoming: GitConflictVersion,
    pub result: Option<String>,
    pub binary: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitResolveConflictRequest {
    pub root_path: String,
    pub relative_path: String,
    pub resolution: String,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryActionRequest {
    pub root_path: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStashEntry {
    pub index: u32,
    pub reference: String,
    pub commit: String,
    pub subject: String,
    pub created_at_epoch_seconds: u64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStashListRequest {
    pub root_path: String,
    pub cursor: Option<u32>,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStashPage {
    pub entries: Vec<GitStashEntry>,
    pub total: usize,
    pub next_cursor: Option<u32>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStashCreateRequest {
    pub root_path: String,
    pub message: String,
    pub include_untracked: bool,
    pub keep_index: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStashActionRequest {
    pub root_path: String,
    pub reference: String,
    pub expected_commit: String,
    pub action: String,
    pub restore_index: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStashDiffRequest {
    pub root_path: String,
    pub reference: String,
    pub expected_commit: String,
    pub request_id: String,
    pub timeout_ms: u64,
    pub max_bytes: usize,
}
