use crate::models::workspace::{ArkTsFileStub, ArkTsParseError};
use crate::services::workspace_file_index_policy_service::{
    classify_workspace_file, WorkspaceFileLayerPolicy, WORKSPACE_FULL_CONTENT_MAX_BYTES,
};
use crate::services::workspace_index_parse_pool_service::{
    WorkspaceIndexParseJob, WorkspaceIndexParsePool, WorkspaceIndexParseResult,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_performance_config_service::{
    resolve_performance_config, PerformanceUserSettings,
};
use crate::services::workspace_stub_index_service::normalize_index_path;
use crate::services::workspace_stub_refresh_plan_service::{
    plan_workspace_stub_refresh, WorkspaceStubRefreshPlan,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct PreparedWorkspaceStubRefresh {
    pub(crate) indexed_generation: u64,
    pub(crate) plan: WorkspaceStubRefreshPlan,
    pub(crate) stubs: Vec<ArkTsFileStub>,
}

pub(crate) fn prepare_changed_stub_rows(
    root_key: &str,
    changed_paths: &[String],
    removed_paths: &[String],
    indexed_generation: u64,
    priority: WorkspaceIndexTaskPriority,
) -> PreparedWorkspaceStubRefresh {
    let (indexed_paths, policy_skipped_paths) = partition_symbol_paths(root_key, changed_paths);
    let mut removed_or_skipped = removed_paths.to_vec();
    removed_or_skipped.extend(policy_skipped_paths);
    let plan = plan_workspace_stub_refresh(&indexed_paths, &removed_or_skipped);
    let stubs = parse_stub_files(root_key, &plan.indexed_paths, indexed_generation, priority);
    PreparedWorkspaceStubRefresh {
        indexed_generation,
        plan,
        stubs,
    }
}

fn partition_symbol_paths(root_key: &str, paths: &[String]) -> (Vec<String>, Vec<String>) {
    let filesystem_root = root_key.replace('\\', "/");
    paths.iter().cloned().partition(|path| {
        classify_workspace_file(
            Path::new(&filesystem_root),
            Path::new(path),
            WORKSPACE_FULL_CONTENT_MAX_BYTES,
        )
        .map(|policy| policy.symbols == WorkspaceFileLayerPolicy::Index)
        .unwrap_or(true)
    })
}

pub(crate) fn parse_stub_files(
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
    priority: WorkspaceIndexTaskPriority,
) -> Vec<ArkTsFileStub> {
    let jobs = parse_jobs_for_paths(root_key, file_paths, indexed_generation, priority);
    let performance_config = resolve_performance_config(&PerformanceUserSettings::default());
    let pool = WorkspaceIndexParsePool::arkts_stub_pool_from_config(&performance_config);
    let mut stubs = pool
        .parse_batch(jobs)
        .into_iter()
        .filter_map(stub_from_parse_result)
        .collect::<Vec<_>>();
    stubs.sort_by(|left, right| left.path.cmp(&right.path));
    stubs
}

fn stub_from_parse_result(result: WorkspaceIndexParseResult) -> Option<ArkTsFileStub> {
    if let Some(parsed) = result.parsed {
        return Some(parsed.stub);
    }
    result.error.map(|error| ArkTsFileStub {
        path: result.job.path,
        module_name: None,
        imports: Vec::new(),
        exports: Vec::new(),
        declarations: Vec::new(),
        parse_errors: vec![ArkTsParseError {
            message: error,
            line: 1,
            column: 1,
        }],
    })
}

fn parse_jobs_for_paths(
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
    priority: WorkspaceIndexTaskPriority,
) -> Vec<WorkspaceIndexParseJob> {
    file_paths
        .iter()
        .map(|path| normalize_index_path(path))
        .filter(|path| is_source_file(path))
        .map(|path| WorkspaceIndexParseJob {
            root_path: root_key.to_string(),
            path,
            priority,
            generation: indexed_generation,
        })
        .collect()
}

#[cfg(test)]
pub(crate) fn stub_parse_jobs_for_paths_for_test(
    root_key: &str,
    file_paths: &[String],
    indexed_generation: u64,
    priority: WorkspaceIndexTaskPriority,
) -> Vec<WorkspaceIndexParseJob> {
    parse_jobs_for_paths(root_key, file_paths, indexed_generation, priority)
}

fn is_source_file(path: &str) -> bool {
    path.ends_with(".ets") || path.ends_with(".ts") || path.ends_with(".d.ts")
}
