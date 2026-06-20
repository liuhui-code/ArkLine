use std::collections::HashSet;
use std::sync::Mutex;

use crate::models::language::{
    CompletionItem, DefinitionTarget, HoverResponse, LanguageQueryRequest, LanguageServiceReport,
};

#[derive(Default)]
pub struct LanguageRuntime {
    active_workspaces: Mutex<HashSet<String>>,
}

pub fn inspect_runtime(runtime: &LanguageRuntime) -> LanguageServiceReport {
    let running = !runtime
        .active_workspaces
        .lock()
        .expect("language runtime workspace lock")
        .is_empty();

    LanguageServiceReport {
        provider: "none".to_string(),
        running,
        hover: false,
        definition: false,
        completion: false,
        detail: "ArkTS language service is not configured yet; adapter skeleton only".to_string(),
    }
}

pub fn hover_symbol(_runtime: &LanguageRuntime, _request: &LanguageQueryRequest) -> Option<HoverResponse> {
    None
}

pub fn goto_definition(
    _runtime: &LanguageRuntime,
    _request: &LanguageQueryRequest,
) -> Option<DefinitionTarget> {
    None
}

pub fn complete_symbol(
    _runtime: &LanguageRuntime,
    _request: &LanguageQueryRequest,
) -> Vec<CompletionItem> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::{complete_symbol, goto_definition, hover_symbol, inspect_runtime, LanguageRuntime};
    use crate::models::language::LanguageQueryRequest;

    fn request() -> LanguageQueryRequest {
        LanguageQueryRequest {
            path: "C:/samples/DemoWorkspace/src/main.ets".to_string(),
            line: 1,
            column: 1,
        }
    }

    #[test]
    fn reports_skeleton_language_runtime() {
        let runtime = LanguageRuntime::default();
        let report = inspect_runtime(&runtime);

        assert_eq!(report.provider, "none");
        assert!(!report.running);
        assert!(!report.hover);
        assert!(!report.definition);
        assert!(!report.completion);
    }

    #[test]
    fn returns_empty_semantic_results_until_provider_is_wired() {
        let runtime = LanguageRuntime::default();

        assert!(hover_symbol(&runtime, &request()).is_none());
        assert!(goto_definition(&runtime, &request()).is_none());
        assert!(complete_symbol(&runtime, &request()).is_empty());
    }
}
