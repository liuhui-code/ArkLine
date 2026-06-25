use std::path::PathBuf;
use std::sync::Arc;

use crate::models::language::{
    CodeAction, CodeActionResolution, CodeActionResolveRequest, CompletionItem,
    DefinitionCandidate, DefinitionTarget, DocumentSymbol, HoverResponse, LanguageQueryRequest,
    LanguageServiceReport, UnsupportedCodeActionResolution, UsageResult,
};
use crate::services::semantic_host::config::SemanticHostConfig;
use crate::services::semantic_host::manager::SemanticHostManager;
use crate::services::semantic_host::process::ARKLINE_SEMANTIC_WORKER_ENTRY_ENV;
use crate::services::semantic_host::session::SemanticWorkerSession;

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
    node_path: PathBuf,
    readiness_detail: String,
    sdk_ready: bool,
    session: Arc<SemanticWorkerSession>,
}

impl ArkTsLspProvider {
    pub fn discover(config: SemanticHostConfig) -> Result<Self, String> {
        let manager = SemanticHostManager::discover(config);
        let readiness = manager.readiness();
        if !readiness.is_ready() {
            return Err(readiness.detail());
        }

        let session = manager.session()?;
        let binary_path = readiness
            .worker
            .entry_path
            .clone()
            .ok_or_else(|| readiness.detail())?;
        let node_path = readiness
            .worker
            .node_path
            .clone()
            .ok_or_else(|| readiness.detail())?;

        Ok(Self {
            binary_path,
            node_path,
            readiness_detail: readiness.detail(),
            sdk_ready: readiness.has_sdk(),
            session,
        })
    }

    pub fn discovery(config: SemanticHostConfig) -> ArkTsLspDiscovery {
        let manager = SemanticHostManager::discover(config);
        let readiness = manager.readiness();

        match (&readiness.worker.entry_path, &readiness.worker.node_path) {
            (Some(binary_path), Some(node_path)) => ArkTsLspDiscovery {
                binary_path: Some(binary_path.clone()),
                node_path: Some(node_path.clone()),
                detail: format!(
                    "Discovered ArkLine semantic worker at {} using node {}",
                    binary_path.display(),
                    node_path.display()
                ),
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
        let running = self.session.health().is_ok();
        LanguageServiceReport {
            provider: "semantic-host".to_string(),
            mode: "semantic".to_string(),
            running,
            hover: false,
            definition: true,
            completion: true,
            document_symbols: false,
            find_usages: false,
            detail: format!(
                "Semantic worker active at {} using node {}; {}",
                self.binary_path.display(),
                self.node_path.display(),
                if self.sdk_ready {
                    self.readiness_detail.as_str()
                } else {
                    "HarmonyOS SDK is optional here; ArkLine is using the independent semantic worker path"
                }
            ),
        }
    }

    fn hover(&self, _request: &LanguageQueryRequest) -> Option<HoverResponse> {
        None
    }

    fn definition(&self, request: &LanguageQueryRequest) -> Option<DefinitionTarget> {
        self.session.goto_definition(request).ok().flatten()
    }

    fn definition_candidates(&self, request: &LanguageQueryRequest) -> Vec<DefinitionCandidate> {
        self.session
            .goto_definition_candidates(request)
            .unwrap_or_default()
    }

    fn completion(&self, request: &LanguageQueryRequest) -> Vec<CompletionItem> {
        self.session.completion(request).unwrap_or_default()
    }

    fn document_symbols(&self, _request: &LanguageQueryRequest) -> Vec<DocumentSymbol> {
        Vec::new()
    }

    fn usages(&self, _request: &LanguageQueryRequest) -> Vec<UsageResult> {
        Vec::new()
    }

    fn code_actions(&self, request: &LanguageQueryRequest) -> Vec<CodeAction> {
        self.session.list_code_actions(request).unwrap_or_default()
    }

    fn resolve_code_action(&self, request: &CodeActionResolveRequest) -> CodeActionResolution {
        self.session
            .resolve_code_action(request)
            .unwrap_or_else(|error| {
                CodeActionResolution::Unsupported(UnsupportedCodeActionResolution {
                    status: "unsupported".to_string(),
                    reason: error,
                })
            })
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
    fn points_to_repo_local_worker_dist() {
        let candidate = default_worker_entry_candidate();

        assert!(candidate
            .to_string_lossy()
            .contains("semantic-worker/dist/main.js"));
    }
}
