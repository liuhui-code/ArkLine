use std::path::PathBuf;
use std::sync::Arc;

use crate::models::diagnostics::ValidationQueryResult;
use crate::models::language::{
    CodeAction, CodeActionResolution, CodeActionResolveRequest, CompletionItem,
    DefinitionCandidate, DefinitionTarget, DocumentSymbol, HoverResponse, LanguageQueryRequest,
    LanguageServiceReport, RenameSymbolResult, SemanticDocumentCloseRequest,
    SemanticDocumentPrepareRequest, SemanticDocumentSyncRequest, SignatureHelp,
    UnsupportedCodeActionResolution, UsageQueryResult,
};
use crate::services::semantic_host::config::SemanticHostConfig;
use crate::services::semantic_host::launcher::{
    direct_semantic_worker_launcher, SharedSemanticWorkerLauncher,
};
use crate::services::semantic_host::manager::SemanticHostManager;
use crate::services::semantic_host::process::ARKLINE_SEMANTIC_WORKER_ENTRY_ENV;

use super::provider::SemanticProvider;

#[allow(dead_code)]
pub const ARKTS_LSP_PATH_ENV: &str = ARKLINE_SEMANTIC_WORKER_ENTRY_ENV;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArkTsLspDiscovery {
    pub binary_path: Option<PathBuf>,
    pub node_path: Option<PathBuf>,
    pub detail: String,
}

pub struct ArkTsLspProvider {
    binary_path: PathBuf,
    node_path: Option<PathBuf>,
    readiness_detail: String,
    sdk_ready: bool,
    manager: Arc<SemanticHostManager>,
}

impl ArkTsLspProvider {
    pub fn discover(config: SemanticHostConfig) -> Result<Self, String> {
        Self::discover_with_launcher(config, direct_semantic_worker_launcher())
    }

    pub fn discover_with_launcher(
        config: SemanticHostConfig,
        launcher: SharedSemanticWorkerLauncher,
    ) -> Result<Self, String> {
        let manager = Arc::new(SemanticHostManager::discover_with_launcher(
            config, launcher,
        ));
        manager.start_idle_watchdog();
        let readiness = manager.readiness();
        if !readiness.is_ready() {
            return Err(readiness.detail());
        }

        let binary_path = readiness
            .worker
            .entry_path
            .clone()
            .ok_or_else(|| readiness.detail())?;
        let node_path = readiness.worker.node_path.clone();

        Ok(Self {
            binary_path,
            node_path,
            readiness_detail: readiness.detail(),
            sdk_ready: readiness.has_sdk(),
            manager,
        })
    }

    pub fn discovery(config: SemanticHostConfig) -> ArkTsLspDiscovery {
        Self::discovery_with_launcher(config, direct_semantic_worker_launcher())
    }

    pub fn discovery_with_launcher(
        config: SemanticHostConfig,
        launcher: SharedSemanticWorkerLauncher,
    ) -> ArkTsLspDiscovery {
        let manager = SemanticHostManager::discover_with_launcher(config, launcher);
        let readiness = manager.readiness();

        match &readiness.worker.entry_path {
            Some(binary_path) if readiness.is_ready() => ArkTsLspDiscovery {
                binary_path: Some(binary_path.clone()),
                node_path: readiness.worker.node_path.clone(),
                detail: readiness.detail(),
            },
            _ => ArkTsLspDiscovery {
                binary_path: None,
                node_path: None,
                detail: readiness.detail(),
            },
        }
    }
}

impl SemanticProvider for ArkTsLspProvider {
    fn report(&self) -> LanguageServiceReport {
        let running = self.manager.request(|session| session.health()).is_ok();
        let runtime = self
            .node_path
            .as_ref()
            .map(|path| format!("node {}", path.display()))
            .unwrap_or_else(|| "standalone runtime".to_string());
        let supervisor = self.manager.supervisor_snapshot();
        let memory = supervisor
            .runtime
            .as_ref()
            .map(|value| format!("{} MiB", value.rss_bytes / 1024 / 1024))
            .unwrap_or_else(|| "not sampled".to_string());
        LanguageServiceReport {
            provider: "semantic-host".to_string(),
            mode: "semantic".to_string(),
            running,
            hover: false,
            definition: true,
            completion: true,
            document_symbols: false,
            find_usages: true,
            capabilities: vec![
                "definition".to_string(),
                "findUsages".to_string(),
                "diagnostics".to_string(),
                "completion".to_string(),
                "signatureHelp".to_string(),
                "codeActions".to_string(),
                "renameSymbol".to_string(),
                "generateCode".to_string(),
            ],
            detail: format!(
                "Semantic worker active at {} using {}; supervisor={}, restarts={}, failures={}, rss={}/{} MiB; {}",
                self.binary_path.display(),
                runtime,
                supervisor.status,
                supervisor.restart_count,
                supervisor.consecutive_failures,
                memory,
                supervisor.memory_budget_bytes / 1024 / 1024,
                if self.sdk_ready {
                    self.readiness_detail.as_str()
                } else {
                    "HarmonyOS SDK is optional here; ArkLine is using the independent semantic worker path"
                }
            ),
            supervisor: Some(supervisor),
        }
    }

    fn hover(&self, _request: &LanguageQueryRequest) -> Option<HoverResponse> {
        None
    }

    fn definition(&self, request: &LanguageQueryRequest) -> Option<DefinitionTarget> {
        self.manager
            .request(|session| session.goto_definition(request))
            .ok()
            .flatten()
    }

    fn definition_candidates(&self, request: &LanguageQueryRequest) -> Vec<DefinitionCandidate> {
        self.manager
            .request(|session| session.goto_definition_candidates(request))
            .unwrap_or_default()
    }

    fn definition_candidates_with_document_version(
        &self,
        request: &LanguageQueryRequest,
        document_version: Option<u64>,
    ) -> Vec<DefinitionCandidate> {
        self.manager
            .request_interactive(|session| {
                session.goto_definition_candidates_with_document_version(request, document_version)
            })
            .unwrap_or_default()
    }

    fn completion(&self, request: &LanguageQueryRequest) -> Vec<CompletionItem> {
        self.manager
            .request_interactive(|session| session.completion(request))
            .unwrap_or_default()
    }

    fn completion_with_document_version(
        &self,
        request: &LanguageQueryRequest,
        document_version: Option<u64>,
    ) -> Vec<CompletionItem> {
        self.manager
            .request_interactive(|session| {
                session.completion_with_document_version(request, document_version)
            })
            .unwrap_or_default()
    }

    fn resolve_completion(
        &self,
        request: &LanguageQueryRequest,
        item: &CompletionItem,
        document_version: Option<u64>,
    ) -> CompletionItem {
        self.manager
            .request_interactive(|session| {
                session.resolve_completion(request, item, document_version)
            })
            .unwrap_or_else(|_| item.clone())
    }

    fn signature_help(&self, request: &LanguageQueryRequest) -> Option<SignatureHelp> {
        self.manager
            .request_interactive(|session| session.signature_help(request))
            .ok()
            .flatten()
    }

    fn document_symbols(&self, _request: &LanguageQueryRequest) -> Vec<DocumentSymbol> {
        Vec::new()
    }

    fn usages(&self, request: &LanguageQueryRequest) -> UsageQueryResult {
        self.manager
            .request_interactive(|session| session.usages(request))
            .unwrap_or_else(UsageQueryResult::unavailable)
    }

    fn diagnostics(&self, request: &LanguageQueryRequest) -> ValidationQueryResult {
        self.manager
            .request_interactive(|session| session.diagnostics(request))
            .unwrap_or_else(ValidationQueryResult::unavailable)
    }

    fn code_actions(&self, request: &LanguageQueryRequest) -> Vec<CodeAction> {
        self.manager
            .request(|session| session.list_code_actions(request))
            .unwrap_or_default()
    }

    fn resolve_code_action(&self, request: &CodeActionResolveRequest) -> CodeActionResolution {
        self.manager
            .request(|session| session.resolve_code_action(request))
            .unwrap_or_else(|error| {
                CodeActionResolution::Unsupported(UnsupportedCodeActionResolution {
                    status: "unsupported".to_string(),
                    reason: error,
                })
            })
    }

    fn rename_symbol(
        &self,
        request: &LanguageQueryRequest,
        new_name: &str,
        document_version: Option<u64>,
    ) -> RenameSymbolResult {
        self.manager
            .request_interactive(|session| {
                session.rename_symbol(request, new_name, document_version)
            })
            .unwrap_or_else(RenameSymbolResult::unavailable)
    }

    fn sync_document(&self, request: &SemanticDocumentSyncRequest) -> Result<(), String> {
        self.manager.request_interactive(|session| {
            session.sync_document(
                &request.method,
                &request.path,
                &request.content,
                request.document_version,
                request.workspace_root.as_deref(),
            )
        })
    }

    fn prepare_document(&self, request: &SemanticDocumentPrepareRequest) -> Result<(), String> {
        self.manager
            .request(|session| session.prepare_document(&request.path, request.document_version))
    }

    fn close_document(&self, request: &SemanticDocumentCloseRequest) -> Result<(), String> {
        self.manager
            .request_interactive(|session| session.close_document(&request.path))
    }
}

#[cfg(test)]
mod tests {
    use crate::services::semantic_host::process::default_worker_entry_candidate;

    use super::ARKTS_LSP_PATH_ENV;

    #[test]
    fn uses_semantic_worker_override_env_name() {
        assert_eq!(ARKTS_LSP_PATH_ENV, "ARKLINE_SEMANTIC_WORKER_ENTRY");
    }

    #[test]
    fn points_to_repo_local_worker_bundle() {
        let candidate = default_worker_entry_candidate();

        assert!(candidate
            .to_string_lossy()
            .contains("semantic-worker/bundle/semantic-worker.cjs"));
    }
}
