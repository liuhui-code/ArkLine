use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use crate::models::git::{GitDiffDocument, GitFileDiffRequest};
use crate::services::git_query_service::GitQueryRuntime;

pub fn load_comparison_documents(
    queries: &GitQueryRuntime,
    root: &Path,
    request: &GitFileDiffRequest,
) -> Result<(GitDiffDocument, GitDiffDocument), String> {
    let limit = request.max_bytes.clamp(64 * 1024, 16 * 1024 * 1024);
    if request.scope.as_deref() == Some("commit") {
        let before_path = request
            .original_path
            .as_deref()
            .unwrap_or(&request.relative_path);
        return Ok((
            read_git_document(
                queries,
                root,
                request,
                &format!("HEAD:{before_path}"),
                limit,
            )?,
            read_worktree_document(root, &request.relative_path, limit)?,
        ));
    }
    if request.staged {
        let before_path = request
            .original_path
            .as_deref()
            .unwrap_or(&request.relative_path);
        return Ok((
            read_git_document(
                queries,
                root,
                request,
                &format!("HEAD:{before_path}"),
                limit,
            )?,
            read_git_document(
                queries,
                root,
                request,
                &format!(":{}", request.relative_path),
                limit,
            )?,
        ));
    }
    Ok((
        read_git_document(
            queries,
            root,
            request,
            &format!(":{}", request.relative_path),
            limit,
        )?,
        read_worktree_document(root, &request.relative_path, limit)?,
    ))
}

fn read_git_document(
    queries: &GitQueryRuntime,
    root: &Path,
    request: &GitFileDiffRequest,
    revision: &str,
    limit: usize,
) -> Result<GitDiffDocument, String> {
    let output = queries.run(
        &request.request_id,
        root,
        &["show", revision],
        request.timeout_ms,
        limit,
    )?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        return if missing_revision(&message) {
            Ok(missing_document())
        } else {
            Err(message.trim().to_string())
        };
    }
    Ok(document_from_bytes(
        output.stdout,
        output.stdout_total_bytes,
        output.stdout_truncated,
    ))
}

fn read_worktree_document(
    root: &Path,
    relative_path: &str,
    limit: usize,
) -> Result<GitDiffDocument, String> {
    let path = root.join(relative_path);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(missing_document()),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink() {
        let target = fs::read_link(path).map_err(|error| error.to_string())?;
        let bytes = target.to_string_lossy().as_bytes().to_vec();
        let total_bytes = bytes.len();
        return Ok(document_from_bytes(bytes, total_bytes, false));
    }
    if !metadata.is_file() {
        return Err(format!(
            "Git comparison path is not a file: {relative_path}"
        ));
    }
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
    file.by_ref()
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    let truncated = bytes.len() > limit;
    if truncated {
        bytes.truncate(limit);
    }
    let total_bytes = if truncated {
        metadata.len() as usize
    } else {
        bytes.len()
    };
    Ok(document_from_bytes(bytes, total_bytes, truncated))
}

fn document_from_bytes(bytes: Vec<u8>, total_bytes: usize, truncated: bool) -> GitDiffDocument {
    let binary = bytes.contains(&0);
    GitDiffDocument {
        exists: true,
        binary,
        content: (!binary).then(|| String::from_utf8_lossy(&bytes).into_owned()),
        truncated,
        total_bytes,
    }
}

fn missing_document() -> GitDiffDocument {
    GitDiffDocument {
        exists: false,
        binary: false,
        content: None,
        truncated: false,
        total_bytes: 0,
    }
}

fn missing_revision(message: &str) -> bool {
    [
        "does not exist in",
        "does not exist (neither on disk nor in the index)",
        "exists on disk, but not in",
        "invalid object name 'HEAD'",
        "bad revision 'HEAD",
        "bad object HEAD",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}
