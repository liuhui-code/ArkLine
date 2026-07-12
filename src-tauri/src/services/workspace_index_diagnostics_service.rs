use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use std::collections::HashMap;

use crate::models::workspace::{
    WorkspaceIndexDiagnostics, WorkspaceIndexEvent, WorkspaceIndexQueuePressure,
    WorkspaceIndexSchemaVersionAction, WorkspaceIndexTimelineItem,
};
use crate::services::workspace_index_event_service::load_recent_index_events;
use crate::services::workspace_index_repair_action_service::{
    workspace_index_health_status, workspace_index_repair_actions, WorkspaceIndexRepairActionInput,
};
use crate::services::workspace_index_repair_service::{
    inspect_parser_failures, inspect_unresolved_imports,
};
use crate::services::workspace_index_resume_service::load_resume_tasks;
use crate::services::workspace_index_schema_service::{
    ensure_workspace_index_schema, load_workspace_index_schema_versions,
};
use crate::services::workspace_index_schema_version_service::{
    plan_workspace_index_schema_version_actions, WorkspaceIndexSchemaVersionStatus,
};

const DIAGNOSTICS_PARSER_FAILURE_LIMIT: usize = 5;
const DIAGNOSTICS_UNRESOLVED_IMPORT_LIMIT: usize = 5;

pub fn inspect_workspace_index(root_path: &str) -> Result<WorkspaceIndexDiagnostics, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    let connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let active_sdk = load_active_sdk_metadata(&connection, &root_key)?;
    let index_status = load_status(&connection, &root_key)?;
    let discovery = load_discovery_diagnostics(&connection, &root_key)?;

    let recent_events = load_recent_index_events(root_path, 20)?;
    let timeline = timeline_from_events(&recent_events);
    let last_error = last_error_from_events(&recent_events);
    let last_explain_status = last_explain_status_from_events(&recent_events);
    let retry_backoff_count = retry_backoff_count_from_events(&recent_events);
    let latest_retry_backoff = latest_retry_backoff_from_events(&recent_events);
    let unresolved_import_count =
        count_rows(&connection, "workspace_unresolved_imports", &root_key)?;
    let parser_error_count = count_rows(&connection, "workspace_stub_parse_errors", &root_key)?;
    let sdk_symbol_count = count_sdk_symbols(&connection, &root_key, active_sdk.as_ref())?;
    let health_status = workspace_index_health_status(&index_status, sdk_symbol_count);
    let schema_versions = load_workspace_index_schema_versions(&connection)?;
    let schema_version_actions = diagnostics_schema_version_actions(&schema_versions);
    let schema_needs_rebuild = schema_version_actions
        .iter()
        .any(|action| action.status == "needs-rebuild");
    let repair_actions = workspace_index_repair_actions(&WorkspaceIndexRepairActionInput {
        status: health_status.to_string(),
        unresolved_import_count,
        parser_error_count,
        has_active_sdk: active_sdk.is_some(),
        has_resume_tasks: !load_resume_tasks(root_path)?.is_empty(),
        schema_needs_rebuild,
    });

    Ok(WorkspaceIndexDiagnostics {
        root_path: root_key.clone(),
        status: index_status,
        schema_version_actions,
        schema_versions,
        file_count: count_rows(&connection, "workspace_files", &root_key)?,
        symbol_count: count_rows(&connection, "workspace_symbols", &root_key)?,
        content_line_count: count_rows(&connection, "workspace_content_lines", &root_key)?,
        fingerprint_count: count_rows(&connection, "workspace_file_fingerprints", &root_key)?,
        stub_file_count: count_rows(&connection, "workspace_stub_files", &root_key)?,
        stub_declaration_count: count_rows(&connection, "workspace_stub_declarations", &root_key)?,
        dependency_edge_count: count_rows(&connection, "workspace_dependency_edges", &root_key)?,
        unresolved_import_count,
        parser_error_count,
        stale_generation_count: count_stale_generations(&connection, &root_key)?,
        sdk_symbol_count,
        discovery_status: discovery.status,
        discovered_file_count: discovery.discovered_count,
        discovery_excluded_count: discovery.excluded_count,
        discovery_has_more: discovery.has_more,
        db_size_bytes: db_size_bytes(&cache_path)?,
        queue_pressure: empty_queue_pressure(&root_key),
        active_sdk_path: active_sdk
            .as_ref()
            .map(|metadata| denormalize_index_path(&metadata.sdk_path)),
        active_sdk_version: active_sdk.map(|metadata| metadata.sdk_version),
        last_error,
        last_explain_status,
        retry_backoff_count,
        latest_retry_backoff,
        repair_actions,
        parser_failures: inspect_parser_failures(root_path, DIAGNOSTICS_PARSER_FAILURE_LIMIT)?,
        unresolved_imports: inspect_unresolved_imports(
            root_path,
            DIAGNOSTICS_UNRESOLVED_IMPORT_LIMIT,
        )?,
        recent_events,
        timeline,
    })
}

fn diagnostics_schema_version_actions(
    schema_versions: &HashMap<String, i64>,
) -> Vec<WorkspaceIndexSchemaVersionAction> {
    plan_workspace_index_schema_version_actions(schema_versions)
        .into_iter()
        .map(|action| WorkspaceIndexSchemaVersionAction {
            domain: action.domain,
            expected_version: action.expected_version,
            persisted_version: action.persisted_version,
            status: schema_version_status_label(action.status).to_string(),
        })
        .collect()
}

fn schema_version_status_label(status: WorkspaceIndexSchemaVersionStatus) -> &'static str {
    match status {
        WorkspaceIndexSchemaVersionStatus::Compatible => "compatible",
        WorkspaceIndexSchemaVersionStatus::MissingVersion => "missing-version",
        WorkspaceIndexSchemaVersionStatus::NeedsRebuild => "needs-rebuild",
    }
}

pub fn inspect_workspace_index_with_queue_pressure(
    root_path: &str,
    queue_pressure: WorkspaceIndexQueuePressure,
) -> Result<WorkspaceIndexDiagnostics, String> {
    let mut diagnostics = inspect_workspace_index(root_path)?;
    diagnostics.queue_pressure = queue_pressure;
    apply_queue_health_projection(&mut diagnostics);
    Ok(diagnostics)
}

fn apply_queue_health_projection(diagnostics: &mut WorkspaceIndexDiagnostics) {
    let health_status =
        workspace_index_health_status(&diagnostics.status, diagnostics.sdk_symbol_count);
    if health_status == "healthy" || diagnostics.queue_pressure.workspace_pending_task_count == 0 {
        return;
    }

    diagnostics.status = "queued".to_string();
    diagnostics.repair_actions = workspace_index_repair_actions(&WorkspaceIndexRepairActionInput {
        status: diagnostics.status.clone(),
        unresolved_import_count: diagnostics.unresolved_import_count,
        parser_error_count: diagnostics.parser_error_count,
        has_active_sdk: diagnostics.active_sdk_path.is_some(),
        has_resume_tasks: diagnostics
            .repair_actions
            .iter()
            .any(|action| action == "resumeIndexing"),
        schema_needs_rebuild: diagnostics
            .schema_version_actions
            .iter()
            .any(|action| action.status == "needs-rebuild"),
    });
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct DiscoveryDiagnostics {
    status: Option<String>,
    discovered_count: i64,
    excluded_count: i64,
    has_more: bool,
}

#[derive(Debug, Clone)]
struct ActiveSdkMetadata {
    sdk_path: String,
    sdk_version: String,
}

fn open_index_store(root_path: &str) -> Result<Connection, String> {
    let cache_path = sqlite_catalog_cache_path(root_path);
    let Some(parent) = cache_path.parent() else {
        return Err(format!(
            "Workspace SQLite index path has no parent: {}",
            cache_path.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    Connection::open(cache_path).map_err(|error| error.to_string())
}

fn load_discovery_diagnostics(
    connection: &Connection,
    root_key: &str,
) -> Result<DiscoveryDiagnostics, String> {
    connection
        .query_row(
            "select status, discovered_count, excluded_count, cursor_json
             from workspace_discovery_state
             where root_path = ?1
             limit 1",
            params![root_key],
            |row| {
                let cursor_json: Option<String> = row.get(3)?;
                Ok(DiscoveryDiagnostics {
                    status: Some(row.get(0)?),
                    discovered_count: row.get(1)?,
                    excluded_count: row.get(2)?,
                    has_more: cursor_json
                        .as_ref()
                        .map(|value| !value.trim().is_empty() && value != "[]")
                        .unwrap_or(false),
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
        .map(|discovery| discovery.unwrap_or_default())
}

fn db_size_bytes(cache_path: &Path) -> Result<u64, String> {
    cache_path
        .metadata()
        .map(|metadata| metadata.len())
        .map_err(|error| error.to_string())
}

fn load_status(connection: &Connection, root_key: &str) -> Result<String, String> {
    let mut statement = connection
        .prepare(
            "select status
             from workspace_index_metadata
             where root_path = ?1
             limit 1",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement
        .query_map(params![root_key], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.next()
        .transpose()
        .map_err(|error| error.to_string())
        .map(|status| status.unwrap_or_else(|| "empty".to_string()))
}

fn count_rows(connection: &Connection, table_name: &str, root_key: &str) -> Result<i64, String> {
    let sql = format!("select count(*) from {table_name} where root_path = ?1");
    connection
        .query_row(&sql, params![root_key], |row| row.get(0))
        .map_err(|error| error.to_string())
}

fn count_sdk_symbols(
    connection: &Connection,
    root_key: &str,
    active_sdk: Option<&ActiveSdkMetadata>,
) -> Result<i64, String> {
    let Some(active_sdk) = active_sdk else {
        return count_rows(connection, "workspace_sdk_symbols", root_key);
    };
    connection
        .query_row(
            "select count(*)
             from workspace_sdk_symbols
             where root_path = ?1 and sdk_path = ?2 and sdk_version = ?3",
            params![root_key, active_sdk.sdk_path, active_sdk.sdk_version],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn count_stale_generations(connection: &Connection, root_key: &str) -> Result<i64, String> {
    connection
        .query_row(
            "select count(*)
             from workspace_index_task_journal
             where root_path = ?1 and status = 'stale'",
            params![root_key],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn load_active_sdk_metadata(
    connection: &Connection,
    root_key: &str,
) -> Result<Option<ActiveSdkMetadata>, String> {
    let mut statement = connection
        .prepare(
            "select sdk_path, sdk_version
             from workspace_sdk_index_metadata
             where root_path = ?1
             limit 1",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement
        .query_map(params![root_key], |row| {
            Ok(ActiveSdkMetadata {
                sdk_path: row.get(0)?,
                sdk_version: row.get(1)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.next().transpose().map_err(|error| error.to_string())
}

fn sqlite_catalog_cache_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("index")
        .join("workspace-catalog.sqlite")
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

fn denormalize_index_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn empty_queue_pressure(root_key: &str) -> WorkspaceIndexQueuePressure {
    WorkspaceIndexQueuePressure {
        root_path: root_key.to_string(),
        pending_task_count: 0,
        workspace_pending_task_count: 0,
        highest_priority: None,
        highest_priority_task_kind: None,
    }
}

fn timeline_from_events(events: &[WorkspaceIndexEvent]) -> Vec<WorkspaceIndexTimelineItem> {
    let mut last_by_task_id = HashMap::new();
    events
        .iter()
        .map(|event| {
            let duration_ms = event
                .task_id
                .as_ref()
                .and_then(|task_id| last_by_task_id.insert(task_id.clone(), event.created_at))
                .map(|previous_at| event.created_at.saturating_sub(previous_at));
            WorkspaceIndexTimelineItem {
                scope: event.scope.to_string(),
                kind: event.kind.to_string(),
                phase: event.phase.to_string(),
                title: format!("{} {}", event.kind, event.phase),
                severity: event.severity.to_string(),
                message: event.message.to_string(),
                task_id: event.task_id.clone(),
                generation: event.generation,
                occurred_at: event.created_at,
                duration_ms,
            }
        })
        .collect()
}

fn last_error_from_events(events: &[WorkspaceIndexEvent]) -> Option<String> {
    events
        .iter()
        .rev()
        .find(|event| event.severity == "error")
        .map(|event| event.message.to_string())
}

fn last_explain_status_from_events(events: &[WorkspaceIndexEvent]) -> Option<String> {
    events
        .iter()
        .rev()
        .find(|event| event.scope == "query")
        .map(|event| event.phase.to_string())
}

fn retry_backoff_count_from_events(events: &[WorkspaceIndexEvent]) -> i64 {
    events
        .iter()
        .filter(|event| event.scope == "scheduler" && event.phase == "backoff")
        .count() as i64
}

fn latest_retry_backoff_from_events(events: &[WorkspaceIndexEvent]) -> Option<String> {
    events
        .iter()
        .rev()
        .find(|event| event.scope == "scheduler" && event.phase == "backoff")
        .map(|event| event.message.to_string())
}
