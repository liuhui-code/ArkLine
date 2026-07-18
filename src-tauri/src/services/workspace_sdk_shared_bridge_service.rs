use std::path::Path;

use crate::services::workspace_index_query_path_service::open_index_store;
use crate::services::workspace_index_schema_service::ensure_workspace_index_schema;
use crate::services::workspace_sdk_api_cache_service::sdk_api_file_manifest_fingerprint;
use crate::services::workspace_sdk_api_scan_plan_service::plan_sdk_api_scan;
use crate::services::workspace_sdk_binding_service::{load_sdk_binding, record_sdk_binding};
use crate::services::workspace_sdk_parser_service::WorkspaceSdkSymbol;
use crate::services::workspace_shared_sdk_artifact_service::{
    SharedSdkArtifactIdentity, SharedSdkArtifactStatus, SharedSdkArtifactStore,
};
use crate::services::workspace_shared_sdk_path_service::shared_sdk_store_path;

pub fn publish_complete_sdk_artifact(
    root_path: &str,
    sdk_path: &str,
    sdk_version: &str,
    symbols: &[WorkspaceSdkSymbol],
) -> Result<SharedSdkArtifactIdentity, String> {
    let identity = build_identity(sdk_path, sdk_version)?;
    open_store(root_path)?.replace_ready(&identity, symbols)?;
    Ok(identity)
}

pub fn publish_sdk_artifact_chunk(
    root_path: &str,
    sdk_path: &str,
    sdk_version: &str,
    symbols: &[WorkspaceSdkSymbol],
    replace_existing: bool,
) -> Result<SharedSdkArtifactIdentity, String> {
    let identity = if replace_existing {
        build_identity(sdk_path, sdk_version)?
    } else {
        load_active_sdk_identity(root_path)?
            .ok_or_else(|| "Workspace SDK binding is missing for continuation chunk".to_string())?
    };
    if identity.sdk_path != normalize_path(sdk_path) || identity.sdk_version != sdk_version {
        return Err("Workspace SDK continuation does not match the active artifact".to_string());
    }
    let store = open_store(root_path)?;
    if replace_existing {
        store.begin(&identity)?;
    }
    store.append(&identity, symbols)?;
    Ok(identity)
}

pub fn mark_active_sdk_artifact_ready(root_path: &str) -> Result<(), String> {
    let identity = load_active_sdk_identity(root_path)?
        .ok_or_else(|| "Workspace SDK binding is missing".to_string())?;
    open_store(root_path)?.mark_ready(&identity)
}

pub fn query_shared_sdk_name_candidates(
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<Option<Vec<WorkspaceSdkSymbol>>, String> {
    let Some(identity) = load_active_sdk_identity(root_path)? else {
        return Ok(None);
    };
    let store = open_store(root_path)?;
    if store.status(&identity)?.is_none() {
        return Ok(None);
    }
    store
        .query_name_candidates(&identity, query, limit)
        .map(Some)
}

pub fn query_shared_sdk_prefix_candidates(
    root_path: &str,
    prefix: &str,
    container: Option<&str>,
    limit: usize,
) -> Result<Option<Vec<WorkspaceSdkSymbol>>, String> {
    let Some(identity) = load_active_sdk_identity(root_path)? else {
        return Ok(None);
    };
    open_store(root_path)?
        .query_prefix_candidates(&identity, prefix, container, limit)
        .map(Some)
}

pub fn query_shared_sdk_symbol_by_id(
    root_path: &str,
    symbol_id: &str,
) -> Result<Option<WorkspaceSdkSymbol>, String> {
    let Some(identity) = load_active_sdk_identity(root_path)? else {
        return Ok(None);
    };
    open_store(root_path)?.query_by_symbol_id(&identity, symbol_id)
}

pub fn query_shared_sdk_exact_symbols(
    root_path: &str,
    kind: &str,
    name: &str,
    container: Option<&str>,
    limit: usize,
) -> Result<Option<Vec<WorkspaceSdkSymbol>>, String> {
    let Some(identity) = load_active_sdk_identity(root_path)? else {
        return Ok(None);
    };
    open_store(root_path)?
        .query_exact(&identity, kind, name, container, limit)
        .map(Some)
}

pub fn count_shared_sdk_symbols(root_path: &str) -> Result<Option<i64>, String> {
    let Some(identity) = load_active_sdk_identity(root_path)? else {
        return Ok(None);
    };
    open_store(root_path)?.count_symbols(&identity).map(Some)
}

pub fn try_reuse_ready_shared_sdk_artifact(
    root_path: &str,
    sdk_path: &str,
    sdk_version: &str,
) -> Result<Option<usize>, String> {
    let store_path = shared_sdk_store_path(root_path)?;
    try_reuse_ready_shared_sdk_artifact_from_store(root_path, sdk_path, sdk_version, &store_path)
}

pub(crate) fn try_reuse_ready_shared_sdk_artifact_from_store(
    root_path: &str,
    sdk_path: &str,
    sdk_version: &str,
    store_path: &Path,
) -> Result<Option<usize>, String> {
    let identity = build_identity(sdk_path, sdk_version)?;
    let store = SharedSdkArtifactStore::open(store_path)?;
    if store.status(&identity)? != Some(SharedSdkArtifactStatus::Ready) {
        return Ok(None);
    }
    let count = usize::try_from(store.count_symbols(&identity)?).unwrap_or_default();
    let mut connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    record_sdk_binding(
        &transaction,
        &normalize_workspace_path(root_path),
        &normalize_workspace_path(sdk_path),
        sdk_version,
        &identity,
        "ready",
    )?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(Some(count))
}

pub fn query_shared_sdk_members_from_binding(
    connection: &rusqlite::Connection,
    root_path: &str,
    root_key: &str,
) -> Result<Option<Vec<WorkspaceSdkSymbol>>, String> {
    let Some(identity) = load_sdk_binding(connection, root_key)? else {
        return Ok(None);
    };
    open_store(root_path)?.query_members(&identity).map(Some)
}

pub fn load_active_sdk_identity(
    root_path: &str,
) -> Result<Option<SharedSdkArtifactIdentity>, String> {
    let connection = match open_index_store(root_path) {
        Ok(connection) => connection,
        Err(_) => return Ok(None),
    };
    ensure_workspace_index_schema(&connection)?;
    load_sdk_binding(&connection, &normalize_workspace_path(root_path))
}

fn build_identity(sdk_path: &str, sdk_version: &str) -> Result<SharedSdkArtifactIdentity, String> {
    let files = plan_sdk_api_scan(sdk_path)?.files;
    let manifest_fingerprint = sdk_api_file_manifest_fingerprint(&files)?;
    Ok(SharedSdkArtifactIdentity::new(
        sdk_path,
        sdk_version,
        &manifest_fingerprint,
    ))
}

fn open_store(root_path: &str) -> Result<SharedSdkArtifactStore, String> {
    SharedSdkArtifactStore::open(&shared_sdk_store_path(root_path)?)
}

fn normalize_path(value: &str) -> String {
    value.replace('\\', "/")
}

fn normalize_workspace_path(value: &str) -> String {
    value.replace('/', "\\")
}
