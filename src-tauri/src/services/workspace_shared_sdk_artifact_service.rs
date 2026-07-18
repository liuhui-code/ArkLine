use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::services::workspace_sdk_api_cache_service::{sdk_api_cache_key, SDK_API_PARSER_VERSION};
use crate::services::workspace_sdk_parser_service::WorkspaceSdkSymbol;
use crate::services::workspace_shared_sdk_posting_service::insert_shared_sdk_symbol_postings;
use crate::services::workspace_shared_sdk_query_service::{
    count_symbols, query_by_symbol_id, query_exact, query_members, query_name_candidates,
    query_prefix_candidates,
};
use crate::services::workspace_shared_sdk_schema_service::{
    ensure_shared_sdk_schema, shared_sdk_symbol_acronym,
};
use crate::services::workspace_symbol_identity_service::sdk_symbol_id;

const SHARED_SDK_SCHEMA_VERSION: i64 = 1;
static SHARED_SDK_WRITE_GATE: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedSdkArtifactIdentity {
    pub artifact_key: String,
    pub sdk_path: String,
    pub sdk_version: String,
    pub manifest_fingerprint: String,
    pub parser_version: String,
}

impl SharedSdkArtifactIdentity {
    pub fn new(sdk_path: &str, sdk_version: &str, manifest_fingerprint: &str) -> Self {
        let sdk_path = normalize_path(sdk_path);
        Self {
            artifact_key: sdk_api_cache_key(
                &sdk_path,
                sdk_version,
                SDK_API_PARSER_VERSION,
                manifest_fingerprint,
            ),
            sdk_path,
            sdk_version: sdk_version.to_string(),
            manifest_fingerprint: manifest_fingerprint.to_string(),
            parser_version: SDK_API_PARSER_VERSION.to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SharedSdkArtifactStatus {
    Building,
    Ready,
    Failed,
}

pub struct SharedSdkArtifactStore {
    path: PathBuf,
}

impl SharedSdkArtifactStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let store = Self {
            path: path.to_path_buf(),
        };
        let _guard = writer_guard()?;
        let connection = store.connection()?;
        ensure_shared_sdk_schema(&connection)?;
        Ok(store)
    }

    pub fn replace_ready(
        &self,
        identity: &SharedSdkArtifactIdentity,
        symbols: &[WorkspaceSdkSymbol],
    ) -> Result<(), String> {
        let _guard = writer_guard()?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        upsert_artifact(&transaction, identity, "building")?;
        delete_artifact_symbols(&transaction, &identity.artifact_key)?;
        insert_symbols(&transaction, identity, symbols)?;
        update_status(&transaction, &identity.artifact_key, "ready")?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn begin(&self, identity: &SharedSdkArtifactIdentity) -> Result<(), String> {
        let _guard = writer_guard()?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        upsert_artifact(&transaction, identity, "building")?;
        delete_artifact_symbols(&transaction, &identity.artifact_key)?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn append(
        &self,
        identity: &SharedSdkArtifactIdentity,
        symbols: &[WorkspaceSdkSymbol],
    ) -> Result<(), String> {
        let _guard = writer_guard()?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        require_artifact(&transaction, &identity.artifact_key)?;
        insert_symbols(&transaction, identity, symbols)?;
        update_symbol_count(&transaction, &identity.artifact_key)?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn mark_ready(&self, identity: &SharedSdkArtifactIdentity) -> Result<(), String> {
        let _guard = writer_guard()?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        update_status(&transaction, &identity.artifact_key, "ready")?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn status(
        &self,
        identity: &SharedSdkArtifactIdentity,
    ) -> Result<Option<SharedSdkArtifactStatus>, String> {
        let connection = self.connection()?;
        let status = connection
            .query_row(
                "select status from shared_sdk_artifacts where artifact_key = ?1",
                [&identity.artifact_key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        status.map(parse_status).transpose()
    }

    pub fn query_name_candidates(
        &self,
        identity: &SharedSdkArtifactIdentity,
        query: &str,
        limit: usize,
    ) -> Result<Vec<WorkspaceSdkSymbol>, String> {
        let connection = self.connection()?;
        validate_artifact(&connection, &identity.artifact_key)?;
        query_name_candidates(&connection, &identity.artifact_key, query, limit)
    }

    pub fn query_prefix_candidates(
        &self,
        identity: &SharedSdkArtifactIdentity,
        prefix: &str,
        container: Option<&str>,
        limit: usize,
    ) -> Result<Vec<WorkspaceSdkSymbol>, String> {
        let connection = self.connection()?;
        validate_artifact(&connection, &identity.artifact_key)?;
        query_prefix_candidates(
            &connection,
            &identity.artifact_key,
            prefix,
            container,
            limit,
        )
    }

    pub fn query_by_symbol_id(
        &self,
        identity: &SharedSdkArtifactIdentity,
        symbol_id: &str,
    ) -> Result<Option<WorkspaceSdkSymbol>, String> {
        let connection = self.connection()?;
        validate_artifact(&connection, &identity.artifact_key)?;
        query_by_symbol_id(&connection, &identity.artifact_key, symbol_id)
    }

    pub fn query_exact(
        &self,
        identity: &SharedSdkArtifactIdentity,
        kind: &str,
        name: &str,
        container: Option<&str>,
        limit: usize,
    ) -> Result<Vec<WorkspaceSdkSymbol>, String> {
        let connection = self.connection()?;
        validate_artifact(&connection, &identity.artifact_key)?;
        query_exact(
            &connection,
            &identity.artifact_key,
            kind,
            name,
            container,
            limit,
        )
    }

    pub fn count_symbols(&self, identity: &SharedSdkArtifactIdentity) -> Result<i64, String> {
        let connection = self.connection()?;
        validate_artifact(&connection, &identity.artifact_key)?;
        count_symbols(&connection, &identity.artifact_key)
    }

    pub fn query_members(
        &self,
        identity: &SharedSdkArtifactIdentity,
    ) -> Result<Vec<WorkspaceSdkSymbol>, String> {
        let connection = self.connection()?;
        validate_artifact(&connection, &identity.artifact_key)?;
        query_members(&connection, &identity.artifact_key)
    }

    fn connection(&self) -> Result<Connection, String> {
        let connection = Connection::open(&self.path).map_err(|error| error.to_string())?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| error.to_string())?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| error.to_string())?;
        connection
            .pragma_update(None, "synchronous", "NORMAL")
            .map_err(|error| error.to_string())?;
        Ok(connection)
    }
}

fn writer_guard() -> Result<MutexGuard<'static, ()>, String> {
    SHARED_SDK_WRITE_GATE
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Shared SDK writer gate is poisoned".to_string())
}

fn upsert_artifact(
    transaction: &Transaction<'_>,
    identity: &SharedSdkArtifactIdentity,
    status: &str,
) -> Result<(), String> {
    transaction
        .execute(
            "insert into shared_sdk_artifacts (
                artifact_key, sdk_path, sdk_version, manifest_fingerprint,
                parser_version, schema_version, status, symbol_count, updated_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, strftime('%s','now') * 1000)
             on conflict(artifact_key) do update set
                sdk_path = excluded.sdk_path,
                sdk_version = excluded.sdk_version,
                manifest_fingerprint = excluded.manifest_fingerprint,
                parser_version = excluded.parser_version,
                schema_version = excluded.schema_version,
                status = excluded.status,
                symbol_count = 0,
                updated_at = excluded.updated_at",
            params![
                identity.artifact_key,
                identity.sdk_path,
                identity.sdk_version,
                identity.manifest_fingerprint,
                identity.parser_version,
                SHARED_SDK_SCHEMA_VERSION,
                status,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn insert_symbols(
    transaction: &Transaction<'_>,
    identity: &SharedSdkArtifactIdentity,
    symbols: &[WorkspaceSdkSymbol],
) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "insert or replace into shared_sdk_symbols (
                artifact_key, symbol_id, kind, name, normalized_name, acronym, path,
                line, column, container, signature
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )
        .map_err(|error| error.to_string())?;
    for symbol in symbols {
        let symbol_id = sdk_symbol_id(
            &symbol.path,
            &symbol.kind,
            symbol.container.as_deref(),
            &symbol.name,
            symbol.line as i64,
            symbol.column as i64,
        );
        statement
            .execute(params![
                identity.artifact_key,
                symbol_id,
                symbol.kind,
                symbol.name,
                symbol.name.to_lowercase(),
                shared_sdk_symbol_acronym(&symbol.name),
                symbol.path,
                symbol.line as i64,
                symbol.column as i64,
                symbol.container,
                symbol.signature,
            ])
            .map_err(|error| error.to_string())?;
        insert_shared_sdk_symbol_postings(
            transaction,
            &identity.artifact_key,
            &symbol_id,
            &symbol.name,
        )?;
    }
    Ok(())
}

fn delete_artifact_symbols(
    transaction: &Transaction<'_>,
    artifact_key: &str,
) -> Result<(), String> {
    transaction
        .execute(
            "delete from shared_sdk_symbols where artifact_key = ?1",
            [artifact_key],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "delete from shared_sdk_symbol_trigrams where artifact_key = ?1",
            [artifact_key],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn require_artifact(transaction: &Transaction<'_>, artifact_key: &str) -> Result<(), String> {
    let exists = transaction
        .query_row(
            "select 1 from shared_sdk_artifacts where artifact_key = ?1",
            [artifact_key],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err(format!(
            "Shared SDK artifact does not exist: {artifact_key}"
        ))
    }
}

fn update_status(
    transaction: &Transaction<'_>,
    artifact_key: &str,
    status: &str,
) -> Result<(), String> {
    let changed = transaction
        .execute(
            "update shared_sdk_artifacts
             set status = ?2,
                 symbol_count = (select count(*) from shared_sdk_symbols where artifact_key = ?1),
                 updated_at = strftime('%s','now') * 1000
             where artifact_key = ?1",
            params![artifact_key, status],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err(format!(
            "Shared SDK artifact does not exist: {artifact_key}"
        ));
    }
    Ok(())
}

fn update_symbol_count(transaction: &Transaction<'_>, artifact_key: &str) -> Result<(), String> {
    transaction
        .execute(
            "update shared_sdk_artifacts
             set symbol_count = (select count(*) from shared_sdk_symbols where artifact_key = ?1),
                 updated_at = strftime('%s','now') * 1000
             where artifact_key = ?1",
            [artifact_key],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn validate_artifact(connection: &Connection, artifact_key: &str) -> Result<(), String> {
    let counts = connection
        .query_row(
            "select artifact.symbol_count,
                    (select count(*) from shared_sdk_symbols where artifact_key = ?1)
             from shared_sdk_artifacts artifact
             where artifact.artifact_key = ?1 and artifact.status != 'failed'",
            [artifact_key],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Shared SDK artifact is unavailable: {artifact_key}"))?;
    if counts.0 != counts.1 {
        return Err(format!(
            "Shared SDK artifact is incomplete: expected {} symbols, found {}",
            counts.0, counts.1
        ));
    }
    Ok(())
}

fn parse_status(status: String) -> Result<SharedSdkArtifactStatus, String> {
    match status.as_str() {
        "building" => Ok(SharedSdkArtifactStatus::Building),
        "ready" => Ok(SharedSdkArtifactStatus::Ready),
        "failed" => Ok(SharedSdkArtifactStatus::Failed),
        _ => Err(format!("Unknown shared SDK artifact status: {status}")),
    }
}

fn normalize_path(value: &str) -> String {
    value.replace('\\', "/")
}
