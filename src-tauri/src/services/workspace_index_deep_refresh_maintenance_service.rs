use crate::services::workspace_index_deep_refresh_catalog_service::prune_terminal_deep_refresh_catalogs;

const DEEP_REFRESH_CATALOG_RETENTION_MS: u128 = 24 * 60 * 60 * 1_000;

pub(crate) fn prune_expired_deep_refresh_catalogs(
    root_path: &str,
    now_ms: u128,
) -> Result<usize, String> {
    let older_than_ms = now_ms.saturating_sub(DEEP_REFRESH_CATALOG_RETENTION_MS) as i64;
    prune_terminal_deep_refresh_catalogs(root_path, older_than_ms)
}
