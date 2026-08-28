use std::cell::Cell;
use std::path::PathBuf;

use crate::services::git_repository_identity_cache_service::{
    GitRepositoryIdentity, GitRepositoryIdentityCache,
};

#[test]
fn resolves_each_canonical_working_directory_once() {
    let mut cache = GitRepositoryIdentityCache::default();
    let working_directory = PathBuf::from("/workspace/project");
    let expected = GitRepositoryIdentity {
        root: working_directory.clone(),
        git_dir: working_directory.join(".git"),
    };
    let resolutions = Cell::new(0);

    let first = cache
        .get_or_resolve(&working_directory, || {
            resolutions.set(resolutions.get() + 1);
            Ok(expected.clone())
        })
        .unwrap();
    let second = cache
        .get_or_resolve(&working_directory, || {
            resolutions.set(resolutions.get() + 1);
            Ok(expected.clone())
        })
        .unwrap();

    assert_eq!(first, expected);
    assert_eq!(second, expected);
    assert_eq!(resolutions.get(), 1);
}
