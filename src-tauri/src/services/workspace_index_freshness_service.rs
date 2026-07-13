use rusqlite::{params, Connection};

use crate::models::workspace::WorkspaceIndexFreshnessLayerSummary;
use crate::services::workspace_stub_index_service::ARKTS_STUB_PARSER_VERSION;

const CONTENT_INDEX_VERSION: i64 = 1;
const SYMBOL_INDEX_VERSION: i64 = 1;

pub(crate) fn load_index_freshness_layers(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<WorkspaceIndexFreshnessLayerSummary>, String> {
    [
        ("content", "content_index_version", CONTENT_INDEX_VERSION),
        ("symbol", "symbol_index_version", SYMBOL_INDEX_VERSION),
        ("stub", "stub_parser_version", ARKTS_STUB_PARSER_VERSION),
    ]
    .into_iter()
    .map(|(layer, column, expected_version)| {
        load_layer_freshness(connection, root_key, layer, column, expected_version)
    })
    .collect()
}

fn load_layer_freshness(
    connection: &Connection,
    root_key: &str,
    layer: &str,
    column: &str,
    expected_version: i64,
) -> Result<WorkspaceIndexFreshnessLayerSummary, String> {
    let sql = format!(
        "select
            sum(case when fingerprint.path is not null and fingerprint.{column} = ?2 then 1 else 0 end),
            sum(case when fingerprint.path is not null and fingerprint.{column} != ?2 then 1 else 0 end),
            sum(case when fingerprint.path is null then 1 else 0 end)
         from workspace_files file
         left join workspace_file_fingerprints fingerprint
            on fingerprint.root_path = file.root_path and fingerprint.path = file.path
         where file.root_path = ?1"
    );
    connection
        .query_row(&sql, params![root_key, expected_version], |row| {
            Ok(WorkspaceIndexFreshnessLayerSummary {
                layer: layer.to_string(),
                ready_count: row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                stale_count: row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                missing_count: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                expected_version,
            })
        })
        .map_err(|error| error.to_string())
}
