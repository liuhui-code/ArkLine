use rusqlite::Connection;

use crate::models::workspace_index_layer::WorkspaceIndexLayerReadiness;
use crate::services::workspace_index_layer_generation_service::{
    load_layer_publication_revision, CONTENT_LAYER, CONTENT_SUBSTRING_LAYER, STUB_LAYER,
};

pub(crate) fn attach_publication_revisions(
    connection: &Connection,
    root_key: &str,
    layers: &mut [WorkspaceIndexLayerReadiness],
) -> Result<(), String> {
    let stub_revision = load_layer_publication_revision(connection, root_key, STUB_LAYER)?;
    let content_revision = load_layer_publication_revision(connection, root_key, CONTENT_LAYER)?;
    let substring_revision =
        load_layer_publication_revision(connection, root_key, CONTENT_SUBSTRING_LAYER)?;
    for layer in layers {
        layer.publication_revision = match layer.layer.as_str() {
            "stub" | "symbols" | "references" | "dependencyGraph" => stub_revision,
            "content" => content_revision,
            "contentSubstring" => substring_revision,
            _ => None,
        };
    }
    Ok(())
}
