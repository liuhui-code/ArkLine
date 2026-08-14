use std::fs;
use std::path::Path;

const MAX_DIRECTORIES: usize = 20_000;

pub fn discover(workspace: &Path) -> Result<Vec<String>, String> {
    let workspace = workspace
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let mut roots = Vec::new();
    let mut pending = vec![workspace];
    let mut visited = 0;
    while let Some(directory) = pending.pop() {
        visited += 1;
        if visited > MAX_DIRECTORIES {
            return Err(
                "Git root discovery exceeded the 20,000-directory safety limit".to_string(),
            );
        }
        if directory.join(".git").exists() {
            roots.push(directory.to_string_lossy().into_owned());
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            if ignored(&name.to_string_lossy()) {
                continue;
            }
            if entry
                .file_type()
                .map(|kind| kind.is_dir() && !kind.is_symlink())
                .unwrap_or(false)
            {
                pending.push(entry.path());
            }
        }
    }
    roots.sort();
    roots.dedup();
    Ok(roots)
}

fn ignored(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "build" | ".idea" | ".cache"
    )
}

#[cfg(test)]
mod tests {
    use super::discover;
    use std::fs;

    #[test]
    fn discovers_nested_roots_without_traversing_generated_directories() {
        let root = std::env::temp_dir().join(format!("arkline-git-roots-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("app/.git")).unwrap();
        fs::create_dir_all(root.join("packages/lib/.git")).unwrap();
        fs::create_dir_all(root.join("node_modules/ignored/.git")).unwrap();
        let roots = discover(&root).unwrap();
        assert_eq!(roots.len(), 2);
        let _ = fs::remove_dir_all(root);
    }
}
