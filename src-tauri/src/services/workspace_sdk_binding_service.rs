use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::services::workspace_shared_sdk_artifact_service::SharedSdkArtifactIdentity;

pub fn record_sdk_binding(
    transaction: &Transaction<'_>,
    root_key: &str,
    sdk_key: &str,
    sdk_version: &str,
    identity: &SharedSdkArtifactIdentity,
    shared_status: &str,
) -> Result<(), String> {
    transaction
        .execute(
            "insert into workspace_sdk_index_metadata (
                root_path, sdk_path, sdk_version, artifact_key, manifest_fingerprint,
                parser_version, shared_status, indexed_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%s','now') * 1000)
             on conflict(root_path) do update set
                sdk_path = excluded.sdk_path,
                sdk_version = excluded.sdk_version,
                artifact_key = excluded.artifact_key,
                manifest_fingerprint = excluded.manifest_fingerprint,
                parser_version = excluded.parser_version,
                shared_status = excluded.shared_status,
                indexed_at = excluded.indexed_at",
            params![
                root_key,
                sdk_key,
                sdk_version,
                identity.artifact_key,
                identity.manifest_fingerprint,
                identity.parser_version,
                shared_status,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn load_sdk_binding(
    connection: &Connection,
    root_key: &str,
) -> Result<Option<SharedSdkArtifactIdentity>, String> {
    connection
        .query_row(
            "select artifact_key, sdk_path, sdk_version, manifest_fingerprint, parser_version
             from workspace_sdk_index_metadata
             where root_path = ?1 and artifact_key is not null",
            [root_key],
            |row| {
                Ok(SharedSdkArtifactIdentity {
                    artifact_key: row.get(0)?,
                    sdk_path: normalize_sdk_path(&row.get::<_, String>(1)?),
                    sdk_version: row.get(2)?,
                    manifest_fingerprint: row.get(3)?,
                    parser_version: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub fn mark_sdk_binding_ready(connection: &Connection, root_key: &str) -> Result<(), String> {
    connection
        .execute(
            "update workspace_sdk_index_metadata
             set shared_status = 'ready', indexed_at = strftime('%s','now') * 1000
             where root_path = ?1",
            [root_key],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn normalize_sdk_path(value: &str) -> String {
    value.replace('\\', "/")
}
