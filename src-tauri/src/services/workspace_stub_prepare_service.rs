use crate::models::workspace::{ArkTsFileStub, ArkTsParseError};
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
    let plan = plan_workspace_stub_refresh(changed_paths, removed_paths);
    let stubs = parse_stub_files(root_key, &plan.indexed_paths, indexed_generation, priority);
    PreparedWorkspaceStubRefresh {
        indexed_generation,
        plan,
        stubs,
    }
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
