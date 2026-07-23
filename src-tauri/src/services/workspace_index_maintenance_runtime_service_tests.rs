use super::{
    plan_maintenance, WorkspaceIndexMaintenanceHistory, WorkspaceIndexMaintenanceRuntime,
    WorkspaceIndexOptimizeMode, WorkspaceIndexStoreStats, CHECKPOINT_COOLDOWN_MS,
    OPTIMIZE_INTERVAL_MS, RECLAIM_COOLDOWN_MS, RECLAIM_MIN_BYTES, WAL_CHECKPOINT_THRESHOLD_BYTES,
};

#[test]
fn first_changed_store_gets_initial_optimize() {
    let plan = plan_maintenance(
        WorkspaceIndexStoreStats::default(),
        WorkspaceIndexMaintenanceHistory::default(),
        1,
        100,
    );

    assert_eq!(plan.optimize, WorkspaceIndexOptimizeMode::Initial);
}

#[test]
fn periodic_optimize_waits_for_writes_and_interval() {
    let history = WorkspaceIndexMaintenanceHistory {
        last_optimize_ms: 100,
        optimized_writer_sample_count: 3,
        ..WorkspaceIndexMaintenanceHistory::default()
    };
    let too_early = plan_maintenance(
        WorkspaceIndexStoreStats::default(),
        history,
        4,
        100 + OPTIMIZE_INTERVAL_MS - 1,
    );
    let ready = plan_maintenance(
        WorkspaceIndexStoreStats::default(),
        history,
        4,
        100 + OPTIMIZE_INTERVAL_MS,
    );

    assert_eq!(too_early.optimize, WorkspaceIndexOptimizeMode::Skip);
    assert_eq!(ready.optimize, WorkspaceIndexOptimizeMode::Periodic);
}

#[test]
fn passive_checkpoint_uses_wal_size_and_cooldown() {
    let stats = WorkspaceIndexStoreStats {
        wal_size_bytes: WAL_CHECKPOINT_THRESHOLD_BYTES,
        ..WorkspaceIndexStoreStats::default()
    };
    let history = WorkspaceIndexMaintenanceHistory {
        last_checkpoint_ms: 10,
        ..WorkspaceIndexMaintenanceHistory::default()
    };

    assert!(!plan_maintenance(stats, history, 0, 10).checkpoint);
    assert!(plan_maintenance(stats, history, 0, 10 + CHECKPOINT_COOLDOWN_MS).checkpoint);
}

#[test]
fn compaction_uses_incremental_or_copy_swap_by_store_mode() {
    let stats = WorkspaceIndexStoreStats {
        db_size_bytes: RECLAIM_MIN_BYTES * 2,
        page_size_bytes: 4_096,
        freelist_pages: (RECLAIM_MIN_BYTES / 4_096) + 10,
        auto_vacuum_mode: 2,
        ..WorkspaceIndexStoreStats::default()
    };
    let ready = plan_maintenance(
        stats,
        WorkspaceIndexMaintenanceHistory::default(),
        0,
        RECLAIM_COOLDOWN_MS,
    );
    let legacy_stats = WorkspaceIndexStoreStats {
        auto_vacuum_mode: 0,
        ..stats
    };
    let legacy = plan_maintenance(
        legacy_stats,
        WorkspaceIndexMaintenanceHistory::default(),
        0,
        RECLAIM_COOLDOWN_MS,
    );

    assert_eq!(ready.incremental_vacuum_pages, 1_024);
    assert!(!ready.copy_swap);
    assert_eq!(legacy.incremental_vacuum_pages, 0);
    assert!(legacy.copy_swap);
    assert_eq!(stats.compaction_status(), "incremental-ready");
    assert_eq!(legacy_stats.compaction_status(), "copy-swap-required");
}

#[test]
fn latency_yield_defers_idle_root_until_a_later_retry() {
    let runtime = WorkspaceIndexMaintenanceRuntime::default();
    runtime
        .pending_idle_roots
        .lock()
        .unwrap()
        .insert("/missing".to_string());

    runtime.run_pending(|| true).unwrap();
    assert_eq!(runtime.pending_idle_roots.lock().unwrap().len(), 1);

    runtime.run_pending(|| false).unwrap();
    assert!(runtime.pending_idle_roots.lock().unwrap().is_empty());
}
