use crate::models::workspace_index_layer::{
    WorkspaceIndexLayerReadiness, WorkspaceIndexLayerStatus,
};

pub(crate) fn enrich_layer_reason(
    mut layer: WorkspaceIndexLayerReadiness,
) -> WorkspaceIndexLayerReadiness {
    if layer.reason.is_none() {
        layer.reason = infer_layer_reason(&layer).map(str::to_string);
    }
    if layer.recommended_action.is_none() {
        layer.recommended_action = infer_layer_action(&layer).map(str::to_string);
    }
    layer
}

fn infer_layer_reason(layer: &WorkspaceIndexLayerReadiness) -> Option<&'static str> {
    if layer.workspace_status == WorkspaceIndexLayerStatus::Failed || layer.failed_count > 0 {
        return Some(failure_reason(layer.layer.as_str()));
    }
    if layer.current_file_status == Some(WorkspaceIndexLayerStatus::Missing) {
        return Some(current_file_missing_reason(layer.layer.as_str()));
    }
    if layer.workspace_status == WorkspaceIndexLayerStatus::Missing {
        return Some(workspace_missing_reason(layer.layer.as_str()));
    }
    if layer.workspace_status == WorkspaceIndexLayerStatus::Partial {
        return Some(workspace_partial_reason(layer.layer.as_str()));
    }
    None
}

fn infer_layer_action(layer: &WorkspaceIndexLayerReadiness) -> Option<&'static str> {
    if layer.workspace_status == WorkspaceIndexLayerStatus::Failed || layer.failed_count > 0 {
        return Some("inspectParserFailures");
    }
    if layer.current_file_status == Some(WorkspaceIndexLayerStatus::Missing) {
        return Some("indexCurrentFile");
    }
    match layer.layer.as_str() {
        "sdk" | "sdkApi" if layer.workspace_status == WorkspaceIndexLayerStatus::Missing => {
            Some("configureSdk")
        }
        "discovery" | "fileCatalog" | "projectFile" | "fingerprint" => Some("rebuildIndex"),
        "projectDeep" | "content" | "stub" | "symbols" | "references" | "dependencyGraph" => {
            Some("wait")
        }
        _ => None,
    }
}

fn failure_reason(layer: &str) -> &'static str {
    match layer {
        "stub" => "Parser failures exist; symbol extraction for affected files is degraded.",
        "fileHot" => "Current-file hot indexing has failures; navigation and completion may be degraded.",
        "projectDeep" => "Deep project indexing has failures; text search, usages, and dependency-aware navigation may be degraded.",
        _ => "This index layer has failures and may return incomplete IDE results.",
    }
}

fn current_file_missing_reason(layer: &str) -> &'static str {
    match layer {
        "fileHot" => "Current file is not in the hot index; foreground indexing must finish before navigation and completion are reliable.",
        "projectFile" | "fileCatalog" => "Current file is missing from the project file catalog; file search and navigation may skip it.",
        "content" => "Current file content is not indexed; global text search may not include this file.",
        "stub" => "Current file parser output is not ready; symbols, members, and usages may be incomplete.",
        "symbols" => "Current file symbols are not ready; class and member navigation may miss this file.",
        "references" => "Current file references are not ready; Find Usages may miss this file.",
        "projectDeep" => "Current file deep indexes are not ready; text search, usages, and dependency-aware navigation may be partial.",
        "discovery" => "Current file is not in workspace discovery yet; foreground indexing has not caught up.",
        _ => "Current file is missing from this index layer.",
    }
}

fn workspace_missing_reason(layer: &str) -> &'static str {
    match layer {
        "sdk" | "sdkApi" => "SDK API symbols are not indexed; system API completion and navigation are unavailable.",
        "projectFile" | "fileCatalog" => "Project file catalog is empty; Search Everywhere file results may be incomplete.",
        "projectDeep" => "Deep project indexes are empty; text search, usages, and dependency-aware navigation are not ready.",
        "content" => "Content index is empty; global text search is not ready.",
        "stub" => "Parser stub index is empty; symbols and member navigation are not ready.",
        "symbols" => "Symbol index is empty; class, method, and member search are not ready.",
        "references" => "Reference index is empty; Find Usages is not ready.",
        "dependencyGraph" => "Dependency graph is empty; import-aware refresh and navigation may be incomplete.",
        "discovery" => "Workspace discovery has not produced file evidence yet.",
        _ => "This index layer has no workspace evidence yet.",
    }
}

fn workspace_partial_reason(layer: &str) -> &'static str {
    match layer {
        "projectDeep" => "Deep project indexes are still incomplete; text search, usages, and dependency-aware navigation may be partial.",
        "sdk" | "sdkApi" => "SDK API indexing is still incomplete; system API results may be partial.",
        "discovery" => "Workspace discovery is still running; some files may not be visible yet.",
        _ => "This index layer is partially ready and may return incomplete results.",
    }
}
