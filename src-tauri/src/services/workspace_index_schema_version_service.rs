use std::collections::HashMap;

use rusqlite::{params, Connection};

const SCHEMA_DOMAINS: &[(&str, i64)] = &[
    ("catalog", 2),
    ("content", 4),
    ("entity", 1),
    ("symbol", 3),
    ("stub", 2),
    ("dependency", 1),
    ("symbol_resolution", 1),
    ("reference", 1),
    ("fingerprint", 1),
    ("sdk", 1),
    ("task_journal", 1),
    ("event", 1),
    ("resume", 1),
    ("discovery", 1),
    ("semantic_layer", 1),
];

#[cfg(test)]
pub(crate) const WORKSPACE_INDEX_SCHEMA_DOMAIN_COUNT: usize = SCHEMA_DOMAINS.len();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceIndexSchemaVersionStatus {
    Compatible,
    MissingVersion,
    NeedsRebuild,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceIndexSchemaVersionAction {
    pub domain: String,
    pub expected_version: i64,
    pub persisted_version: Option<i64>,
    pub status: WorkspaceIndexSchemaVersionStatus,
}

pub(crate) fn create_workspace_index_schema_version_table(
    connection: &Connection,
) -> Result<(), String> {
    connection
        .execute(
            "create table if not exists workspace_index_schema_versions (
                domain text primary key,
                version integer not null,
                migrated_at integer not null default (strftime('%s','now') * 1000)
            )",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn record_workspace_index_schema_versions(
    connection: &Connection,
) -> Result<(), String> {
    create_workspace_index_schema_version_table(connection)?;
    for (domain, version) in SCHEMA_DOMAINS {
        connection
            .execute(
                "insert into workspace_index_schema_versions (domain, version, migrated_at)
                 values (?1, ?2, strftime('%s','now') * 1000)
                 on conflict(domain) do nothing",
                params![domain, version],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn verify_workspace_index_schema_versions(
    connection: &Connection,
) -> Result<(), String> {
    let mut statement = connection
        .prepare("select version from workspace_index_schema_versions where domain = ?1")
        .map_err(|error| format!("Workspace index schema is not initialized: {error}"))?;
    for (domain, expected_version) in SCHEMA_DOMAINS {
        let persisted_version = statement
            .query_row([domain], |row| row.get::<_, i64>(0))
            .map_err(|error| {
                format!("Workspace index schema domain {domain} is missing: {error}")
            })?;
        if persisted_version != *expected_version {
            return Err(format!(
                "Workspace index schema domain {domain} requires version {expected_version}, found {persisted_version}"
            ));
        }
    }
    Ok(())
}

pub(crate) fn plan_workspace_index_schema_version_actions(
    persisted_versions: &HashMap<String, i64>,
) -> Vec<WorkspaceIndexSchemaVersionAction> {
    SCHEMA_DOMAINS
        .iter()
        .map(|(domain, expected_version)| {
            let persisted_version = persisted_versions.get(*domain).copied();
            let status = match persisted_version {
                None => WorkspaceIndexSchemaVersionStatus::MissingVersion,
                Some(version) if version == *expected_version => {
                    WorkspaceIndexSchemaVersionStatus::Compatible
                }
                Some(_) => WorkspaceIndexSchemaVersionStatus::NeedsRebuild,
            };
            WorkspaceIndexSchemaVersionAction {
                domain: (*domain).to_string(),
                expected_version: *expected_version,
                persisted_version,
                status,
            }
        })
        .collect()
}

#[allow(dead_code)]
pub fn load_workspace_index_schema_versions(
    connection: &Connection,
) -> Result<HashMap<String, i64>, String> {
    create_workspace_index_schema_version_table(connection)?;
    read_workspace_index_schema_versions(connection)
}

pub(crate) fn read_workspace_index_schema_versions(
    connection: &Connection,
) -> Result<HashMap<String, i64>, String> {
    let mut statement = connection
        .prepare(
            "select domain, version
             from workspace_index_schema_versions
             order by domain",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<HashMap<_, _>, _>>()
        .map_err(|error| error.to_string())
}
