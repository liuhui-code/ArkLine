use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::models::workspace_edit::{TextRange, WorkspaceEditOperation, WorkspaceEditPlan};

pub(crate) fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-workspace-edit-{name}-{suffix}"))
}

pub(crate) fn remove_temp_dir(root: &Path) {
    let mut last_error = None;
    for _ in 0..80 {
        match fs::remove_dir_all(root) {
            Ok(()) => last_error = None,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                last_error = None;
            }
            Err(error) => last_error = Some(error),
        }
        thread::sleep(Duration::from_millis(25));
        if !root.exists() {
            return;
        }
    }
    panic!(
        "workspace edit test directory remained active after bounded cleanup: root={root:?}; last_error={last_error:?}"
    );
}

pub(crate) fn plan(operations: Vec<WorkspaceEditOperation>) -> WorkspaceEditPlan {
    WorkspaceEditPlan {
        id: "test-plan".to_string(),
        title: "Test plan".to_string(),
        operations,
        conflicts: Vec::new(),
        affected_files: Vec::new(),
        undo_label: "Undo test plan".to_string(),
        requires_preview: false,
    }
}

pub(crate) fn text_edit(path: PathBuf, range: TextRange, new_text: &str) -> WorkspaceEditOperation {
    WorkspaceEditOperation::Text {
        path: path.to_string_lossy().to_string(),
        range,
        new_text: new_text.to_string(),
        expected_version: None,
        expected_content_version: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_waits_until_background_directory_writes_stop() {
        let root = unique_temp_dir("background-cleanup");
        fs::create_dir_all(&root).unwrap();
        let writer_root = root.clone();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let writer = thread::spawn(move || {
            for attempt in 0..40 {
                let _ = fs::create_dir_all(&writer_root);
                let _ = fs::write(writer_root.join(format!("index-{attempt}.tmp")), b"active");
                if attempt == 0 {
                    started_tx.send(()).unwrap();
                }
                thread::sleep(Duration::from_millis(5));
            }
        });
        started_rx.recv().unwrap();

        remove_temp_dir(&root);
        writer.join().unwrap();

        assert!(!root.exists());
    }
}
