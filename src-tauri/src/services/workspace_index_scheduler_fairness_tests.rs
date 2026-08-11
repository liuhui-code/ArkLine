use crate::services::workspace_index_scheduler_service::{
    WorkspaceIndexScheduler, WorkspaceIndexTask, WorkspaceIndexTaskKind, WorkspaceIndexTaskPriority,
};

#[test]
fn scheduler_gives_background_work_a_turn_after_a_bounded_foreground_burst() {
    let mut scheduler = WorkspaceIndexScheduler::default();
    for root_path in [
        "/navigation-one",
        "/navigation-two",
        "/navigation-three",
        "/navigation-four",
    ] {
        scheduler.schedule(task(
            root_path,
            WorkspaceIndexTaskPriority::ForegroundNavigation,
        ));
    }
    scheduler.schedule(task("/background", WorkspaceIndexTaskPriority::Background));

    let roots = (0..5)
        .map(|_| scheduler.drain_ready_batch(8).remove(0).root_path)
        .collect::<Vec<_>>();

    assert_eq!(
        roots,
        vec![
            "/navigation-one",
            "/navigation-two",
            "/navigation-three",
            "/background",
            "/navigation-four",
        ]
    );
}

#[test]
fn scheduler_gives_deep_work_a_turn_during_continuous_visible_file_reads() {
    let mut scheduler = WorkspaceIndexScheduler::default();
    for root_path in [
        "/visible-one",
        "/visible-two",
        "/visible-three",
        "/visible-four",
    ] {
        scheduler.schedule(task(root_path, WorkspaceIndexTaskPriority::VisibleFiles));
    }
    scheduler.schedule(task("/deep", WorkspaceIndexTaskPriority::FullRefresh));

    let roots = (0..5)
        .map(|_| scheduler.drain_ready_batch(8).remove(0).root_path)
        .collect::<Vec<_>>();

    assert_eq!(
        roots,
        vec![
            "/visible-one",
            "/visible-two",
            "/visible-three",
            "/deep",
            "/visible-four",
        ]
    );
}

#[test]
fn scheduler_keeps_foreground_first_when_no_background_work_is_ready() {
    let mut scheduler = WorkspaceIndexScheduler::default();
    for root_path in [
        "/navigation-one",
        "/navigation-two",
        "/navigation-three",
        "/navigation-four",
    ] {
        scheduler.schedule(task(
            root_path,
            WorkspaceIndexTaskPriority::ForegroundNavigation,
        ));
    }

    let roots = (0..4)
        .map(|_| scheduler.drain_ready_batch(8).remove(0).root_path)
        .collect::<Vec<_>>();

    assert_eq!(
        roots,
        vec![
            "/navigation-one",
            "/navigation-two",
            "/navigation-three",
            "/navigation-four",
        ]
    );
}

fn task(root_path: &str, priority: WorkspaceIndexTaskPriority) -> WorkspaceIndexTask {
    WorkspaceIndexTask {
        root_path: root_path.to_string(),
        kind: WorkspaceIndexTaskKind::RefreshWorkspace,
        priority,
        changed_paths: Vec::new(),
        sdk_path: None,
        sdk_version: None,
        generation: 0,
        reason: "fairness-test".to_string(),
    }
}
