use std::sync::Arc;

use super::arkts_lsp_provider::ArkTsLspProvider;
use super::provider::{FallbackProvider, SemanticProvider};
use crate::services::semantic_host::config::SemanticHostConfig;
use crate::services::semantic_host::launcher::{
    direct_semantic_worker_launcher, SharedSemanticWorkerLauncher,
};
use crate::services::semantic_host::manager::SemanticHostReadiness;

pub struct SemanticRouter {
    fallback: Arc<dyn SemanticProvider>,
    semantic: Option<Arc<dyn SemanticProvider>>,
}

impl Default for SemanticRouter {
    fn default() -> Self {
        Self::new(SemanticHostConfig::default())
    }
}

impl SemanticRouter {
    pub fn new(config: SemanticHostConfig) -> Self {
        Self::new_with_launcher(config, direct_semantic_worker_launcher())
    }

    pub fn new_with_launcher(
        config: SemanticHostConfig,
        launcher: SharedSemanticWorkerLauncher,
    ) -> Self {
        let readiness =
            SemanticHostReadiness::discover_with_launcher(config.clone(), launcher.clone());
        let fallback_detail = if readiness.is_ready() {
            format!(
                "Fallback semantic provider stays available for symbol search and degraded-mode recovery: {}",
                readiness.detail()
            )
        } else {
            format!(
                "Fallback semantic provider is active; ArkTS semantic host is unavailable: {}",
                readiness.detail()
            )
        };
        let fallback: Arc<dyn SemanticProvider> = Arc::new(FallbackProvider::new(fallback_detail));
        let semantic = ArkTsLspProvider::discover_with_launcher(config, launcher)
            .ok()
            .map(|provider| {
                Arc::new(CompositeSemanticProvider::new(
                    fallback.clone(),
                    Arc::new(provider),
                )) as Arc<dyn SemanticProvider>
            });

        Self { fallback, semantic }
    }

    pub fn active(&self) -> &dyn SemanticProvider {
        self.semantic.as_deref().unwrap_or(self.fallback.as_ref())
    }
}

struct CompositeSemanticProvider {
    fallback: Arc<dyn SemanticProvider>,
    semantic: Arc<dyn SemanticProvider>,
}

impl CompositeSemanticProvider {
    fn new(fallback: Arc<dyn SemanticProvider>, semantic: Arc<dyn SemanticProvider>) -> Self {
        Self { fallback, semantic }
    }
}

impl SemanticProvider for CompositeSemanticProvider {
    fn report(&self) -> crate::models::language::LanguageServiceReport {
        let mut report = self.semantic.report();
        report.hover = self.fallback.report().hover;
        report.document_symbols = true;
        report.find_usages = true;
        report.detail = format!(
            "{}; fallback remains active for hover, document symbols, and usages",
            report.detail
        );
        report
    }

    fn hover(
        &self,
        request: &crate::models::language::LanguageQueryRequest,
    ) -> Option<crate::models::language::HoverResponse> {
        self.fallback.hover(request)
    }

    fn definition(
        &self,
        request: &crate::models::language::LanguageQueryRequest,
    ) -> Option<crate::models::language::DefinitionTarget> {
        self.semantic
            .definition(request)
            .or_else(|| self.fallback.definition(request))
    }

    fn definition_candidates(
        &self,
        request: &crate::models::language::LanguageQueryRequest,
    ) -> Vec<crate::models::language::DefinitionCandidate> {
        let items = self.semantic.definition_candidates(request);
        if items.is_empty() {
            self.fallback.definition_candidates(request)
        } else {
            items
        }
    }

    fn completion(
        &self,
        request: &crate::models::language::LanguageQueryRequest,
    ) -> Vec<crate::models::language::CompletionItem> {
        let items = self.semantic.completion(request);
        if items.is_empty() {
            self.fallback.completion(request)
        } else {
            items
        }
    }

    fn document_symbols(
        &self,
        request: &crate::models::language::LanguageQueryRequest,
    ) -> Vec<crate::models::language::DocumentSymbol> {
        self.fallback.document_symbols(request)
    }

    fn usages(
        &self,
        request: &crate::models::language::LanguageQueryRequest,
    ) -> Vec<crate::models::language::UsageResult> {
        self.fallback.usages(request)
    }

    fn code_actions(
        &self,
        request: &crate::models::language::LanguageQueryRequest,
    ) -> Vec<crate::models::language::CodeAction> {
        let actions = self.semantic.code_actions(request);
        if actions.is_empty() {
            self.fallback.code_actions(request)
        } else {
            actions
        }
    }

    fn resolve_code_action(
        &self,
        request: &crate::models::language::CodeActionResolveRequest,
    ) -> crate::models::language::CodeActionResolution {
        self.semantic.resolve_code_action(request)
    }
}
