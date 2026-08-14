use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn dependency_restore_required(root: &Path) -> bool {
    dependency_manifests(root).into_iter().any(|manifest| {
        manifest_declares_dependencies(&manifest)
            && !manifest
                .parent()
                .map(|directory| directory.join("oh_modules").is_dir())
                .unwrap_or(false)
    })
}

fn dependency_manifests(root: &Path) -> Vec<PathBuf> {
    let mut manifests = Vec::new();
    let root_manifest = root.join("oh-package.json5");
    if root_manifest.is_file() {
        manifests.push(root_manifest);
    }
    if let Ok(entries) = fs::read_dir(root) {
        manifests.extend(
            entries
                .flatten()
                .filter(|entry| entry.path().join("src/main").is_dir())
                .map(|entry| entry.path().join("oh-package.json5"))
                .filter(|manifest| manifest.is_file()),
        );
    }
    manifests
}

fn manifest_declares_dependencies(manifest: &Path) -> bool {
    let Ok(content) = fs::read_to_string(manifest) else {
        return false;
    };
    ["dependencies", "devDependencies", "dynamicDependencies"]
        .into_iter()
        .any(|field| {
            let pattern = format!(
                r#"(?s)(?:[\"']{field}[\"']|\b{field})\s*:\s*\{{(?:\s|//[^\n]*\n|/\*.*?\*/)*(?:[\"']|[A-Za-z0-9_@])"#
            );
            regex::Regex::new(&pattern)
                .map(|matcher| matcher.is_match(&content))
                .unwrap_or(false)
        })
}
