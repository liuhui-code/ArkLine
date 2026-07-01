use tauri::{AppHandle, State};

use crate::models::language::{DefinitionCandidate, LanguageQueryRequest};
use crate::models::workspace::WorkspaceIndexQueryEnvelope;
use crate::services::language_service::{
    goto_definition as goto_definition_service,
    goto_definition_candidates as goto_definition_candidates_service, LanguageRuntime,
};
use crate::services::settings_store::load_settings_for_app;
use crate::services::workspace_index_query_service::query_definition_candidates_with_readiness as query_definition_candidates_with_readiness_service;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

#[tauri::command]
pub fn query_definition_candidates_with_readiness(
    root_path: String,
    request: LanguageQueryRequest,
    app: AppHandle,
    language_runtime: State<'_, LanguageRuntime>,
    index_runtime: State<'_, WorkspaceIndexRuntime>,
) -> Result<WorkspaceIndexQueryEnvelope<DefinitionCandidate>, String> {
    let settings = load_settings_for_app(&app)?;
    let semantic_target = goto_definition_service(language_runtime.inner(), &settings, &request);
    let semantic_candidates = if semantic_target.is_some() {
        Vec::new()
    } else {
        goto_definition_candidates_service(language_runtime.inner(), &settings, &request)
    };
    query_definition_candidates_with_readiness_service(
        &index_runtime,
        &root_path,
        &request,
        semantic_target,
        semantic_candidates,
    )
}
