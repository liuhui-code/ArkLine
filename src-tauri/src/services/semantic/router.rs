use std::sync::Arc;

use super::arkts_lsp_provider::ArkTsLspProvider;
use super::provider::{FallbackProvider, SemanticProvider};

pub struct SemanticRouter {
    fallback: Arc<dyn SemanticProvider>,
    semantic: Option<Arc<dyn SemanticProvider>>,
}

impl Default for SemanticRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl SemanticRouter {
    pub fn new() -> Self {
        let discovery = ArkTsLspProvider::discovery();
        let fallback_detail = match discovery.binary_path {
            Some(path) => format!(
                "Fallback semantic provider is active; ArkTS language server was discovered at {} but semantic request forwarding is not enabled yet",
                path.display()
            ),
            None => format!(
                "Fallback semantic provider is active; ArkTS SDK-backed semantic service is unavailable: {}",
                discovery.detail
            ),
        };

        Self {
            fallback: Arc::new(FallbackProvider::new(fallback_detail)),
            semantic: None,
        }
    }

    pub fn active(&self) -> &dyn SemanticProvider {
        self.semantic.as_deref().unwrap_or(self.fallback.as_ref())
    }
}
