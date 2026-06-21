use std::env;
use std::path::PathBuf;

use crate::models::language::{
    CompletionItem, DefinitionTarget, DocumentSymbol, HoverResponse, LanguageQueryRequest,
    LanguageServiceReport, UsageResult,
};

use super::provider::SemanticProvider;

pub const ARKTS_LSP_PATH_ENV: &str = "ARKLINE_ARKTS_LSP_PATH";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArkTsLspDiscovery {
    pub binary_path: Option<PathBuf>,
    pub detail: String,
}

pub struct ArkTsLspProvider {
    binary_path: PathBuf,
}

impl ArkTsLspProvider {
    pub fn discover() -> Result<Self, String> {
        let configured = env::var(ARKTS_LSP_PATH_ENV).map_err(|_| {
            format!(
                "Set {} to an ArkTS language server executable path",
                ARKTS_LSP_PATH_ENV
            )
        })?;
        let binary_path = PathBuf::from(configured);

        if !binary_path.exists() {
            return Err(format!(
                "Configured ArkTS language server path does not exist: {}",
                binary_path.display()
            ));
        }

        if !binary_path.is_file() {
            return Err(format!(
                "Configured ArkTS language server path is not a file: {}",
                binary_path.display()
            ));
        }

        Ok(Self { binary_path })
    }

    pub fn discovery() -> ArkTsLspDiscovery {
        match Self::discover() {
            Ok(provider) => ArkTsLspDiscovery {
                binary_path: Some(provider.binary_path.clone()),
                detail: format!(
                    "Discovered ArkTS language server at {}",
                    provider.binary_path.display()
                ),
            },
            Err(detail) => ArkTsLspDiscovery {
                binary_path: None,
                detail,
            },
        }
    }
}

impl SemanticProvider for ArkTsLspProvider {
    fn report(&self) -> LanguageServiceReport {
        LanguageServiceReport {
            provider: "arkts-lsp".to_string(),
            mode: "semantic".to_string(),
            running: true,
            hover: false,
            definition: false,
            completion: false,
            document_symbols: false,
            find_usages: false,
            detail: format!(
                "ArkTS language server discovered at {}; semantic request forwarding is not wired yet",
                self.binary_path.display()
            ),
        }
    }

    fn hover(&self, _request: &LanguageQueryRequest) -> Option<HoverResponse> {
        None
    }

    fn definition(&self, _request: &LanguageQueryRequest) -> Option<DefinitionTarget> {
        None
    }

    fn completion(&self, _request: &LanguageQueryRequest) -> Vec<CompletionItem> {
        Vec::new()
    }

    fn document_symbols(&self, _request: &LanguageQueryRequest) -> Vec<DocumentSymbol> {
        Vec::new()
    }

    fn usages(&self, _request: &LanguageQueryRequest) -> Vec<UsageResult> {
        Vec::new()
    }
}
