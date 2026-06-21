use crate::models::language::{
    CompletionItem, DefinitionTarget, DocumentSymbol, HoverResponse, LanguageQueryRequest,
    LanguageServiceReport, UsageResult,
};
use crate::services::semantic::router::SemanticRouter;

#[derive(Default)]
pub struct LanguageRuntime {
    router: SemanticRouter,
}

pub fn inspect_runtime(runtime: &LanguageRuntime) -> LanguageServiceReport {
    runtime.router.active().report()
}

pub fn hover_symbol(runtime: &LanguageRuntime, request: &LanguageQueryRequest) -> Option<HoverResponse> {
    runtime.router.active().hover(request)
}

pub fn goto_definition(
    runtime: &LanguageRuntime,
    request: &LanguageQueryRequest,
) -> Option<DefinitionTarget> {
    runtime.router.active().definition(request)
}

pub fn complete_symbol(
    runtime: &LanguageRuntime,
    request: &LanguageQueryRequest,
) -> Vec<CompletionItem> {
    runtime.router.active().completion(request)
}

pub fn list_document_symbols(
    runtime: &LanguageRuntime,
    request: &LanguageQueryRequest,
) -> Vec<DocumentSymbol> {
    runtime.router.active().document_symbols(request)
}

pub fn find_usages(
    runtime: &LanguageRuntime,
    request: &LanguageQueryRequest,
) -> Vec<UsageResult> {
    runtime.router.active().usages(request)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        complete_symbol, find_usages, goto_definition, hover_symbol, inspect_runtime,
        list_document_symbols, LanguageRuntime,
    };
    use crate::models::language::LanguageQueryRequest;

    fn request(path: &str, line: u32, column: u32) -> LanguageQueryRequest {
        LanguageQueryRequest {
            path: path.to_string(),
            line,
            column,
        }
    }

    fn unique_temp_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-language-{name}-{suffix}.ets"))
    }

    #[test]
    fn reports_skeleton_language_runtime() {
        let runtime = LanguageRuntime::default();
        let report = inspect_runtime(&runtime);

        assert_eq!(report.provider, "fallback");
        assert_eq!(report.mode, "fallback");
        assert!(report.running);
        assert!(!report.hover);
        assert!(report.definition);
        assert!(report.completion);
        assert!(report.document_symbols);
        assert!(report.find_usages);
    }

    #[test]
    fn resolves_same_file_semantic_queries_in_fallback_mode() {
        let runtime = LanguageRuntime::default();
        let path = unique_temp_path("fallback-runtime");
        fs::write(
            &path,
            "@Entry\n@Component\nstruct Index {}\nfunction submit() {\n  Index;\n  submit();\n}\n",
        )
        .unwrap();
        let path_text = path.to_string_lossy().to_string();

        assert!(hover_symbol(&runtime, &request(&path_text, 3, 9)).is_none());
        assert_eq!(
            goto_definition(&runtime, &request(&path_text, 5, 4)),
            Some(crate::models::language::DefinitionTarget {
                path: path_text.clone(),
                line: 3,
                column: 8,
            })
        );
        assert_eq!(
            complete_symbol(&runtime, &request(&path_text, 1, 1)),
            vec![
                crate::models::language::CompletionItem {
                    label: "@Entry".to_string(),
                    detail: "ArkTS decorator".to_string(),
                    kind: "keyword".to_string(),
                },
                crate::models::language::CompletionItem {
                    label: "@Component".to_string(),
                    detail: "ArkTS decorator".to_string(),
                    kind: "keyword".to_string(),
                },
                crate::models::language::CompletionItem {
                    label: "build()".to_string(),
                    detail: "Component lifecycle method".to_string(),
                    kind: "method".to_string(),
                },
                crate::models::language::CompletionItem {
                    label: "submit()".to_string(),
                    detail: "Fallback function".to_string(),
                    kind: "function".to_string(),
                },
            ]
        );
        assert_eq!(
            list_document_symbols(&runtime, &request(&path_text, 1, 1)),
            vec![
                crate::models::language::DocumentSymbol {
                    name: "Index".to_string(),
                    kind: "struct".to_string(),
                    line: 3,
                    column: 8,
                },
                crate::models::language::DocumentSymbol {
                    name: "submit".to_string(),
                    kind: "function".to_string(),
                    line: 4,
                    column: 10,
                },
            ]
        );
        assert_eq!(
            find_usages(&runtime, &request(&path_text, 5, 4)),
            vec![
                crate::models::language::UsageResult {
                    path: path_text.clone(),
                    line: 3,
                    column: 8,
                    preview: "struct Index {}".to_string(),
                },
                crate::models::language::UsageResult {
                    path: path_text.clone(),
                    line: 5,
                    column: 3,
                    preview: "Index;".to_string(),
                },
            ]
        );

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn reports_fallback_mode_when_no_sdk_provider_is_available() {
        let runtime = LanguageRuntime::default();
        let report = inspect_runtime(&runtime);

        assert_eq!(report.mode, "fallback");
        assert_eq!(report.provider, "fallback");
        assert!(report.definition);
        assert!(report.completion);
        assert!(report.detail.contains("SDK"));
    }

    #[test]
    fn keeps_fallback_active_when_sdk_discovery_fails() {
        let runtime = LanguageRuntime::default();
        let report = inspect_runtime(&runtime);

        assert_eq!(report.mode, "fallback");
        assert!(report.detail.contains("ArkTS"));
        assert!(report.detail.contains("ARKLINE_ARKTS_LSP_PATH"));
    }
}
