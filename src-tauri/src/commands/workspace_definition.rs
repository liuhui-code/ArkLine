use tauri::State;

use crate::models::language::{
    CallHierarchyResult, CompletionItem, DefinitionCandidate, LanguageQueryRequest,
    RenameImpactResult, TypeHierarchyResult, UsageResult,
};
use crate::models::workspace::WorkspaceIndexQueryEnvelope;
use crate::services::workspace_index_facade_service::{
    query_facade_completions_with_readiness as query_semantic_completions_with_readiness_service,
    query_facade_definition_candidates_with_readiness as query_definition_candidates_with_readiness_service,
    query_facade_usages_with_readiness as query_usages_with_readiness_service,
};
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_rename_impact_service::query_rename_impact as query_rename_impact_service;
use crate::services::workspace_symbol_hierarchy_service::{
    query_call_hierarchy as query_call_hierarchy_service,
    query_type_hierarchy as query_type_hierarchy_service,
};

#[tauri::command]
pub fn query_definition_candidates_with_readiness(
    root_path: String,
    request: LanguageQueryRequest,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexQueryEnvelope<DefinitionCandidate>, String> {
    // Language-service fallback runs through its dedicated blocking command after an index miss.
    query_definition_candidates_with_readiness_service(
        &index_runtime,
        &root_path,
        &request,
        None,
        Vec::new(),
    )
}

#[tauri::command]
pub fn query_usages_with_readiness(
    root_path: String,
    request: LanguageQueryRequest,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexQueryEnvelope<UsageResult>, String> {
    query_usages_with_readiness_service(&index_runtime, &root_path, &request, 500)
}

#[tauri::command]
pub fn query_rename_impact(
    root_path: String,
    request: LanguageQueryRequest,
) -> Result<Option<RenameImpactResult>, String> {
    query_rename_impact_service(&root_path, &request, 500)
}

#[tauri::command]
pub fn query_call_hierarchy(
    root_path: String,
    request: LanguageQueryRequest,
) -> Result<Option<CallHierarchyResult>, String> {
    query_call_hierarchy_service(&root_path, &request, 500)
}

#[tauri::command]
pub fn query_type_hierarchy(
    root_path: String,
    request: LanguageQueryRequest,
) -> Result<Option<TypeHierarchyResult>, String> {
    query_type_hierarchy_service(&root_path, &request, 500)
}

#[tauri::command]
pub fn semantic_complete_symbol(
    root_path: String,
    request: LanguageQueryRequest,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexQueryEnvelope<CompletionItem>, String> {
    query_semantic_completions_with_readiness_service(&index_runtime, &root_path, &request, 100)
}
