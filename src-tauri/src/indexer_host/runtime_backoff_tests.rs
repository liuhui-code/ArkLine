use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::thread;
use std::time::Duration;

use super::{IndexerDiscoveryAttempt, IndexerHostRuntime};
use crate::indexer_sidecar::IndexerTaskKey;

#[test]
fn repeated_requests_do_not_restart_a_crashing_lane_during_backoff() {
    let root =
        std::env::temp_dir().join(format!("arkline-indexer-backoff-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let executable = root.join("crashing-indexer.sh");
    let launch_log = root.join("launches.txt");
    fs::write(
        &executable,
        format!(
            "#!/bin/sh\nprintf 'x' >> '{}'\nexit 1\n",
            launch_log.display()
        ),
    )
    .unwrap();
    let mut permissions = fs::metadata(&executable).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&executable, permissions).unwrap();

    let runtime = IndexerHostRuntime::with_executable(executable);
    let task = IndexerTaskKey {
        root_path: root.to_string_lossy().to_string(),
        kind: "discovery".to_string(),
        generation: 1,
        reason: "crash-backoff-test".to_string(),
    };

    assert_eq!(
        runtime.discover_workspace_chunk(task.clone(), None, 64),
        IndexerDiscoveryAttempt::Unavailable
    );
    assert_eq!(
        runtime.discover_workspace_chunk(task, None, 64),
        IndexerDiscoveryAttempt::Unavailable
    );

    assert_eq!(fs::read_to_string(&launch_log).unwrap(), "x");
    let first_failure = runtime.snapshot();
    assert_eq!(first_failure.status, "backoff");
    assert_eq!(first_failure.restart_count, 0);
    assert_eq!(first_failure.consecutive_failure_count, 1);
    assert!(first_failure.backoff_remaining_ms.is_some());

    thread::sleep(Duration::from_millis(300));
    assert_eq!(runtime.snapshot().status, "fallback");
    assert_eq!(
        runtime.discover_workspace_chunk(
            IndexerTaskKey {
                root_path: root.to_string_lossy().to_string(),
                kind: "discovery".to_string(),
                generation: 2,
                reason: "crash-backoff-retry".to_string(),
            },
            None,
            64,
        ),
        IndexerDiscoveryAttempt::Unavailable
    );
    let second_failure = runtime.snapshot();
    assert_eq!(fs::read_to_string(&launch_log).unwrap(), "xx");
    assert_eq!(second_failure.restart_count, 1);
    assert_eq!(second_failure.consecutive_failure_count, 2);
    fs::remove_dir_all(root).unwrap();
}
