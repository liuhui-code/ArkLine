use crate::models::language::{
    CodeAction, CodeActionResolution, CodeActionResolveRequest, CompletionItem,
    DefinitionCandidate, DefinitionTarget, DocumentSymbol, HoverResponse, LanguageQueryRequest,
    LanguageServiceReport, UsageResult,
};
use crate::services::document_service::read_text_file;
use crate::services::semantic::router::SemanticRouter;
use crate::services::semantic_host::config::SemanticHostConfig;
use crate::services::settings_store::AppSettings;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct LanguageRuntime {
    state: Arc<Mutex<LanguageRuntimeState>>,
}

struct LanguageRuntimeState {
    config: SemanticHostConfig,
    router: SemanticRouter,
}

impl Default for LanguageRuntime {
    fn default() -> Self {
        let config = SemanticHostConfig::default();
        Self {
            state: Arc::new(Mutex::new(LanguageRuntimeState {
                config: config.clone(),
                router: SemanticRouter::new(config),
            })),
        }
    }
}

impl LanguageRuntime {
    fn with_router<T>(
        &self,
        settings: &AppSettings,
        callback: impl FnOnce(&SemanticRouter) -> T,
    ) -> T {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let next_config = SemanticHostConfig::from_settings(settings);
        if state.config != next_config {
            next_config.apply_to_process_env();
            state.config = next_config.clone();
            state.router = SemanticRouter::new(next_config);
        }

        callback(&state.router)
    }
}

pub fn goto_definition_candidates(
    runtime: &LanguageRuntime,
    settings: &AppSettings,
    request: &LanguageQueryRequest,
) -> Vec<DefinitionCandidate> {
    runtime.with_router(settings, |router| {
        router
            .active()
            .definition_candidates(request)
            .into_iter()
            .map(hydrate_definition_candidate_preview)
            .collect()
    })
}

fn hydrate_definition_candidate_preview(mut candidate: DefinitionCandidate) -> DefinitionCandidate {
    if !candidate.preview.is_empty() {
        return candidate;
    }

    candidate.preview = read_text_file(Path::new(&candidate.path))
        .ok()
        .and_then(|content| {
            content
                .lines()
                .nth(candidate.line.saturating_sub(1) as usize)
                .map(|line| line.trim().to_string())
        })
        .unwrap_or_default();

    candidate
}

pub fn complete_symbol(
    runtime: &LanguageRuntime,
    settings: &AppSettings,
    request: &LanguageQueryRequest,
) -> Vec<CompletionItem> {
    runtime.with_router(settings, |router| router.active().completion(request))
}

pub fn list_document_symbols(
    runtime: &LanguageRuntime,
    settings: &AppSettings,
    request: &LanguageQueryRequest,
) -> Vec<DocumentSymbol> {
    runtime.with_router(settings, |router| router.active().document_symbols(request))
}

pub fn find_usages(
    runtime: &LanguageRuntime,
    settings: &AppSettings,
    request: &LanguageQueryRequest,
) -> Vec<UsageResult> {
    runtime.with_router(settings, |router| router.active().usages(request))
}

pub fn list_code_actions(
    runtime: &LanguageRuntime,
    settings: &AppSettings,
    request: &LanguageQueryRequest,
) -> Vec<CodeAction> {
    runtime.with_router(settings, |router| router.active().code_actions(request))
}

pub fn resolve_code_action(
    runtime: &LanguageRuntime,
    settings: &AppSettings,
    request: &CodeActionResolveRequest,
) -> CodeActionResolution {
    runtime.with_router(settings, |router| {
        router.active().resolve_code_action(request)
    })
}

pub fn inspect_runtime(runtime: &LanguageRuntime, settings: &AppSettings) -> LanguageServiceReport {
    runtime.with_router(settings, |router| router.active().report())
}

pub fn hover_symbol(
    runtime: &LanguageRuntime,
    settings: &AppSettings,
    request: &LanguageQueryRequest,
) -> Option<HoverResponse> {
    runtime.with_router(settings, |router| router.active().hover(request))
}

pub fn goto_definition(
    runtime: &LanguageRuntime,
    settings: &AppSettings,
    request: &LanguageQueryRequest,
) -> Option<DefinitionTarget> {
    runtime.with_router(settings, |router| router.active().definition(request))
}
