use std::path::PathBuf;
use std::sync::Arc;

use crate::models::language::{
    CodeAction, CodeActionResolution, CodeActionResolveRequest, CompletionItem,
    DefinitionCandidate, DefinitionTarget, DocumentSymbol, HoverResponse, LanguageQueryRequest,
    LanguageServiceReport, UnsupportedCodeActionResolution, UsageResult,
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
            find_usages: false,
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

    fn completion(&self, request: &LanguageQueryRequest) -> Vec<CompletionItem> {
        self.manager
            .request(|session| session.completion(request))
            .unwrap_or_default()
    }

    fn document_symbols(&self, _request: &LanguageQueryRequest) -> Vec<DocumentSymbol> {
        Vec::new()
    }

    fn usages(&self, _request: &LanguageQueryRequest) -> Vec<UsageResult> {
        Vec::new()
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
