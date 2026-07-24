use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::workspace::WorkspaceIndexTaskStatus;
use crate::services::workspace_index_cancellation_service::{
    CancellableIndexTask, WorkspaceIndexCancellationRegistry,
};
use crate::services::workspace_index_compaction_service::{
    prepare_workspace_index_compaction, remove_workspace_index_compaction_candidate,
};
use crate::services::workspace_index_connection_service::{
    open_existing_workspace_index_reader, quiesce_workspace_index_store_for_compaction,
    workspace_index_store_path, workspace_index_writer_metrics,
};
use crate::services::workspace_index_maintenance_publication_service::{
    WorkspaceIndexMaintenanceOperation, WorkspaceIndexOptimizeMode,
};
use crate::services::workspace_index_manager_status_service::store_cancelled_statuses;
use crate::services::workspace_index_publication_artifact_service::{
    write_workspace_publication_artifact, WorkspaceIndexPublicationArtifact,
};
use crate::services::workspace_index_publication_scheduler_service::PublicationPriority;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexScheduler;
use crate::services::workspace_index_task_status_service::WorkspaceIndexTaskResult;
use crate::services::workspace_index_writer_actor_service::{
    WorkspaceIndexPublicationAttempt, WorkspaceIndexPublicationRequest, WorkspaceIndexWriterActor,
};

const WAL_CHECKPOINT_THRESHOLD_BYTES: u64 = 16 * 1024 * 1024;
const CHECKPOINT_COOLDOWN_MS: u128 = 30_000;
const OPTIMIZE_INTERVAL_MS: u128 = 60 * 60 * 1_000;
const RECLAIM_COOLDOWN_MS: u128 = 5 * 60 * 1_000;
const RECLAIM_MIN_BYTES: u64 = 64 * 1024 * 1024;
const RECLAIM_MIN_PERCENT: u64 = 20;
const INCREMENTAL_VACUUM_PAGE_LIMIT: u32 = 1_024;

#[derive(Debug, Clone, Default)]
pub(crate) struct WorkspaceIndexMaintenanceRuntime {
    blocked_roots: Arc<Mutex<HashSet<String>>>,
    histories: Arc<Mutex<HashMap<String, WorkspaceIndexMaintenanceHistory>>>,
    pending_idle_roots: Arc<Mutex<BTreeSet<String>>>,
}

#[derive(Debug, Clone, Copy, Default)]
struct WorkspaceIndexMaintenanceHistory {
    last_optimize_ms: u128,
    last_checkpoint_ms: u128,
    last_reclaim_ms: u128,
    optimized_writer_sample_count: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct WorkspaceIndexStoreStats {
    pub(crate) db_size_bytes: u64,
    pub(crate) wal_size_bytes: u64,
    pub(crate) page_size_bytes: u64,
    pub(crate) freelist_pages: u64,
    pub(crate) auto_vacuum_mode: i64,
}

impl WorkspaceIndexStoreStats {
    pub(crate) fn freelist_bytes(self) -> u64 {
        self.page_size_bytes.saturating_mul(self.freelist_pages)
    }

    pub(crate) fn compaction_status(self) -> &'static str {
        if !reclaim_threshold_reached(self) {
            "not-needed"
        } else if self.auto_vacuum_mode == 2 {
            "incremental-ready"
        } else {
            "copy-swap-required"
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct WorkspaceIndexMaintenancePlan {
    optimize: WorkspaceIndexOptimizeMode,
    checkpoint: bool,
    incremental_vacuum_pages: u32,
    copy_swap: bool,
}

impl WorkspaceIndexMaintenancePlan {
    fn operation(self) -> WorkspaceIndexMaintenanceOperation {
        WorkspaceIndexMaintenanceOperation::MaintainStore {
            optimize: self.optimize,
            checkpoint: self.checkpoint,
            incremental_vacuum_pages: self.incremental_vacuum_pages,
        }
    }

    fn is_empty(self) -> bool {
        self.optimize == WorkspaceIndexOptimizeMode::Skip
            && !self.checkpoint
            && self.incremental_vacuum_pages == 0
            && !self.copy_swap
    }

    fn has_store_maintenance(self) -> bool {
        self.optimize != WorkspaceIndexOptimizeMode::Skip
            || self.checkpoint
            || self.incremental_vacuum_pages > 0
    }
}

impl WorkspaceIndexMaintenanceRuntime {
    pub(crate) fn begin(
        &self,
        root_path: &str,
        scheduler: &Arc<Mutex<WorkspaceIndexScheduler>>,
        cancellations: &Arc<Mutex<WorkspaceIndexCancellationRegistry>>,
        recent_statuses: &Arc<Mutex<Vec<WorkspaceIndexTaskStatus>>>,
    ) -> Result<(), String> {
        self.blocked_roots
            .lock()
            .map_err(|_| "Workspace index maintenance lock poisoned".to_string())?
            .insert(root_path.to_string());
        let result = (|| {
            let pending = scheduler
                .lock()
                .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
                .drain_tasks_for_root(root_path);
            cancellations
                .lock()
                .map_err(|_| "Workspace index cancellation lock poisoned".to_string())?
                .cancel_root(root_path);
            store_cancelled_statuses(recent_statuses, pending)
        })();
        if result.is_err() {
            let _ = self.finish(root_path);
        }
        result
    }

    pub(crate) fn finish(&self, root_path: &str) -> Result<(), String> {
        self.blocked_roots
            .lock()
            .map_err(|_| "Workspace index maintenance lock poisoned".to_string())?
            .remove(root_path);
        Ok(())
    }

    pub(crate) fn cancel_blocked_tasks(
        &self,
        tasks: &[CancellableIndexTask],
    ) -> Result<(), String> {
        let roots = self
            .blocked_roots
            .lock()
            .map_err(|_| "Workspace index maintenance lock poisoned".to_string())?;
        for (task, token) in tasks {
            if roots.contains(&task.root_path) {
                token.cancel();
            }
        }
        Ok(())
    }

    pub(crate) fn run_after_results(
        &self,
        results: &[WorkspaceIndexTaskResult],
        mut should_yield: impl FnMut() -> bool,
    ) -> Result<(), String> {
        let roots = results
            .iter()
            .filter(|result| result.error.is_none())
            .map(|result| result.root_path.to_string())
            .collect::<BTreeSet<_>>();
        self.pending_idle_roots
            .lock()
            .map_err(|_| "Workspace maintenance pending roots lock poisoned".to_string())?
            .extend(roots);
        self.run_pending(&mut should_yield)
    }

    pub(crate) fn run_pending(&self, mut should_yield: impl FnMut() -> bool) -> Result<(), String> {
        let roots = self
            .pending_idle_roots
            .lock()
            .map_err(|_| "Workspace maintenance pending roots lock poisoned".to_string())?
            .clone();
        for root_path in roots {
            if should_yield() {
                break;
            }
            if self.run_idle_maintenance(&root_path, &mut should_yield)? {
                self.pending_idle_roots
                    .lock()
                    .map_err(|_| "Workspace maintenance pending roots lock poisoned".to_string())?
                    .remove(&root_path);
            }
        }
        Ok(())
    }

    fn run_idle_maintenance(
        &self,
        root_path: &str,
        mut should_yield: impl FnMut() -> bool,
    ) -> Result<bool, String> {
        if should_yield() {
            return Ok(false);
        }
        let Some(stats) = load_workspace_index_store_stats(root_path)? else {
            return Ok(true);
        };
        let writer_samples = workspace_index_writer_metrics(root_path).sample_count;
        let now_ms = now_epoch_ms()?;
        let history = self
            .histories
            .lock()
            .map_err(|_| "Workspace maintenance history lock poisoned".to_string())?
            .get(root_path)
            .copied()
            .unwrap_or_default();
        let plan = plan_maintenance(stats, history, writer_samples, now_ms);
        if plan.is_empty() {
            return Ok(true);
        }
        if plan.has_store_maintenance() {
            match publish_idle_operation(root_path, plan.operation(), &mut should_yield)? {
                Some(profile) => {
                    let checkpointed = !plan.checkpoint || profile.stages.iter()
                        .any(|stage| stage.name == "maintenanceTruncateCheckpoint");
                    self.record_applied(
                        root_path,
                        plan,
                        writer_samples,
                        now_ms,
                        checkpointed,
                    )?;
                    if !checkpointed {
                        return Ok(false);
                    }
                }
                None => return Ok(false),
            }
        }
        if !plan.copy_swap {
            return Ok(true);
        }
        self.run_copy_swap(root_path, now_ms, should_yield)
    }

    fn run_copy_swap(
        &self,
        root_path: &str,
        now_ms: u128,
        mut should_yield: impl FnMut() -> bool,
    ) -> Result<bool, String> {
        if should_yield() || !quiesce_workspace_index_store_for_compaction(root_path)? {
            return Ok(false);
        }
        let Some(candidate) = prepare_workspace_index_compaction(root_path, &mut should_yield)?
        else {
            return Ok(false);
        };
        let operation = WorkspaceIndexMaintenanceOperation::CompactStore {
            candidate: candidate.clone(),
        };
        let profile = match publish_idle_operation(root_path, operation, &mut should_yield) {
            Ok(Some(profile)) => profile,
            Ok(None) => {
                remove_workspace_index_compaction_candidate(&candidate);
                return Ok(false);
            }
            Err(error) => {
                remove_workspace_index_compaction_candidate(&candidate);
                return Err(error);
            }
        };
        let committed = profile
            .stages
            .iter()
            .any(|stage| stage.name == "maintenanceCopySwapCommit");
        if committed {
            self.histories
                .lock()
                .map_err(|_| "Workspace maintenance history lock poisoned".to_string())?
                .entry(root_path.to_string())
                .or_default()
                .last_reclaim_ms = now_ms;
        }
        Ok(committed)
    }

    fn record_applied(
        &self,
        root_path: &str,
        plan: WorkspaceIndexMaintenancePlan,
        writer_samples: u64,
        now_ms: u128,
        checkpointed: bool,
    ) -> Result<(), String> {
        let mut histories = self
            .histories
            .lock()
            .map_err(|_| "Workspace maintenance history lock poisoned".to_string())?;
        let history = histories.entry(root_path.to_string()).or_default();
        if plan.optimize != WorkspaceIndexOptimizeMode::Skip {
            history.last_optimize_ms = now_ms;
            history.optimized_writer_sample_count = writer_samples;
        }
        if plan.checkpoint && checkpointed {
            history.last_checkpoint_ms = now_ms;
        }
        if plan.incremental_vacuum_pages > 0 {
            history.last_reclaim_ms = now_ms;
        }
        Ok(())
    }
}

pub(crate) fn load_workspace_index_store_stats(
    root_path: &str,
) -> Result<Option<WorkspaceIndexStoreStats>, String> {
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(None);
    };
    workspace_index_store_stats(root_path, &connection).map(Some)
}

pub(crate) fn workspace_index_store_stats(
    root_path: &str,
    connection: &rusqlite::Connection,
) -> Result<WorkspaceIndexStoreStats, String> {
    let store_path = workspace_index_store_path(root_path);
    let stats = WorkspaceIndexStoreStats {
        db_size_bytes: file_size(&store_path)?,
        wal_size_bytes: file_size(&wal_path(&store_path))?,
        page_size_bytes: pragma_u64(&connection, "pragma page_size")?,
        freelist_pages: pragma_u64(&connection, "pragma freelist_count")?,
        auto_vacuum_mode: connection
            .query_row("pragma auto_vacuum", [], |row| row.get(0))
            .map_err(|error| error.to_string())?,
    };
    Ok(stats)
}

fn plan_maintenance(
    stats: WorkspaceIndexStoreStats,
    history: WorkspaceIndexMaintenanceHistory,
    writer_samples: u64,
    now_ms: u128,
) -> WorkspaceIndexMaintenancePlan {
    let has_unoptimized_writes = writer_samples > history.optimized_writer_sample_count;
    let optimize = if !has_unoptimized_writes {
        WorkspaceIndexOptimizeMode::Skip
    } else if history.last_optimize_ms == 0 {
        WorkspaceIndexOptimizeMode::Initial
    } else if elapsed(now_ms, history.last_optimize_ms) >= OPTIMIZE_INTERVAL_MS {
        WorkspaceIndexOptimizeMode::Periodic
    } else {
        WorkspaceIndexOptimizeMode::Skip
    };
    let checkpoint = stats.wal_size_bytes >= WAL_CHECKPOINT_THRESHOLD_BYTES
        && elapsed(now_ms, history.last_checkpoint_ms) >= CHECKPOINT_COOLDOWN_MS;
    let reclaim_ready = stats.auto_vacuum_mode == 2
        && reclaim_threshold_reached(stats)
        && elapsed(now_ms, history.last_reclaim_ms) >= RECLAIM_COOLDOWN_MS;
    WorkspaceIndexMaintenancePlan {
        optimize,
        checkpoint,
        incremental_vacuum_pages: reclaim_ready
            .then_some(
                stats
                    .freelist_pages
                    .min(u64::from(INCREMENTAL_VACUUM_PAGE_LIMIT)) as u32,
            )
            .unwrap_or_default(),
        copy_swap: stats.auto_vacuum_mode != 2
            && reclaim_threshold_reached(stats)
            && elapsed(now_ms, history.last_reclaim_ms) >= RECLAIM_COOLDOWN_MS,
    }
}

fn publish_idle_operation(
    root_path: &str,
    operation: WorkspaceIndexMaintenanceOperation,
    mut should_yield: impl FnMut() -> bool,
) -> Result<
    Option<crate::models::workspace_index_publication::WorkspaceIndexPublicationProfile>,
    String,
> {
    let artifact = WorkspaceIndexPublicationArtifact::Maintenance {
        root_path: root_path.to_string(),
        operation,
    };
    let descriptor = write_workspace_publication_artifact(root_path, &artifact)?;
    match WorkspaceIndexWriterActor::shared().publish(
        WorkspaceIndexPublicationRequest {
            root_path: root_path.to_string(),
            descriptor,
            priority: PublicationPriority::IdleMaintenance,
        },
        &mut should_yield,
    ) {
        WorkspaceIndexPublicationAttempt::Applied(profile) => Ok(Some(profile)),
        WorkspaceIndexPublicationAttempt::Cancelled => Ok(None),
        WorkspaceIndexPublicationAttempt::Failed(error) => Err(error),
    }
}

fn reclaim_threshold_reached(stats: WorkspaceIndexStoreStats) -> bool {
    let free = stats.freelist_bytes();
    free >= RECLAIM_MIN_BYTES
        && free.saturating_mul(100) >= stats.db_size_bytes.saturating_mul(RECLAIM_MIN_PERCENT)
}

fn elapsed(now_ms: u128, previous_ms: u128) -> u128 {
    now_ms.saturating_sub(previous_ms)
}

fn pragma_u64(connection: &rusqlite::Connection, pragma: &str) -> Result<u64, String> {
    connection
        .query_row(pragma, [], |row| row.get::<_, i64>(0))
        .map(|value| u64::try_from(value).unwrap_or_default())
        .map_err(|error| error.to_string())
}

fn file_size(path: &std::path::Path) -> Result<u64, String> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error.to_string()),
    }
}

fn wal_path(store_path: &std::path::Path) -> std::path::PathBuf {
    let mut path = store_path.as_os_str().to_os_string();
    path.push("-wal");
    path.into()
}

fn now_epoch_ms() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "workspace_index_maintenance_runtime_service_tests.rs"]
mod tests;
