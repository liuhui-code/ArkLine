use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::services::process_command_service::hidden_command;

const MAX_REPOSITORY_IDENTITIES: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitRepositoryIdentity {
    pub root: PathBuf,
    pub git_dir: PathBuf,
}

#[derive(Default)]
pub struct GitRepositoryIdentityCache {
    entries: VecDeque<(PathBuf, GitRepositoryIdentity)>,
}

#[derive(Clone, Default)]
pub struct GitRepositoryIdentityRuntime {
    cache: Arc<Mutex<GitRepositoryIdentityCache>>,
}

impl GitRepositoryIdentityRuntime {
    pub fn resolve(&self, path: &Path) -> Result<GitRepositoryIdentity, String> {
        let working_directory = canonical_working_directory(path)?;
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| "Git repository identity cache is unavailable".to_string())?;
        let identity = cache.get_or_resolve(&working_directory, || {
            resolve_repository_identity(&working_directory)
        })?;
        if identity.root.exists() && identity.git_dir.exists() {
            return Ok(identity);
        }
        cache.remove(&working_directory);
        cache.get_or_resolve(&working_directory, || {
            resolve_repository_identity(&working_directory)
        })
    }
}

impl GitRepositoryIdentityCache {
    pub fn get_or_resolve<F>(
        &mut self,
        working_directory: &Path,
        resolve: F,
    ) -> Result<GitRepositoryIdentity, String>
    where
        F: FnOnce() -> Result<GitRepositoryIdentity, String>,
    {
        if let Some(index) = self
            .entries
            .iter()
            .position(|(key, _)| key == working_directory)
        {
            if let Some(entry) = self.entries.remove(index) {
                let identity = entry.1.clone();
                self.entries.push_back(entry);
                return Ok(identity);
            }
        }
        let identity = resolve()?;
        if self.entries.len() >= MAX_REPOSITORY_IDENTITIES {
            self.entries.pop_front();
        }
        self.entries
            .push_back((working_directory.to_path_buf(), identity.clone()));
        Ok(identity)
    }

    pub fn remove(&mut self, working_directory: &Path) {
        self.entries.retain(|(key, _)| key != working_directory);
    }
}

pub fn canonical_working_directory(path: &Path) -> Result<PathBuf, String> {
    let cwd = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };
    cwd.canonicalize().map_err(|error| error.to_string())
}

pub fn resolve_repository_identity(cwd: &Path) -> Result<GitRepositoryIdentity, String> {
    let output = hidden_command("git")
        .args(["rev-parse", "--show-toplevel", "--absolute-git-dir"])
        .current_dir(cwd)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut lines = text.lines();
    let root = lines
        .next()
        .ok_or_else(|| "Git did not return a repository root".to_string())?;
    let git_dir = lines
        .next()
        .ok_or_else(|| "Git did not return a repository metadata directory".to_string())?;
    Ok(GitRepositoryIdentity {
        root: PathBuf::from(root)
            .canonicalize()
            .map_err(|error| error.to_string())?,
        git_dir: PathBuf::from(git_dir),
    })
}
