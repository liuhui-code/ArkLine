use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::language::LanguageQueryRequest;
use crate::services::language_service::{
    complete_symbol, find_usages, goto_definition, goto_definition_candidates, hover_symbol,
    inspect_runtime, list_document_symbols, LanguageRuntime,
};
use crate::services::semantic_host::sdk::HARMONY_SDK_PATH_ENV;
use crate::services::settings_store::default_settings;

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct MockWorker {
    path: PathBuf,
}

impl MockWorker {
    fn path_text(&self) -> String {
        self.path.to_string_lossy().to_string()
    }
}

impl Drop for MockWorker {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

struct ScopedSdkEnv {
    _guard: MutexGuard<'static, ()>,
    previous: Option<String>,
}

impl Drop for ScopedSdkEnv {
    fn drop(&mut self) {
        if let Some(value) = self.previous.take() {
            std::env::set_var(HARMONY_SDK_PATH_ENV, value);
        } else {
            std::env::remove_var(HARMONY_SDK_PATH_ENV);
        }
    }
}

fn request(path: &str, line: u32, column: u32) -> LanguageQueryRequest {
    LanguageQueryRequest {
        path: path.to_string(),
        line,
        column,
        content: None,
    }
}

fn unique_temp_path(name: &str, extension: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-language-{name}-{suffix}.{extension}"))
}

fn mock_worker_entry(definition_path: Option<&str>, completion_labels: &[&str]) -> MockWorker {
    let path = unique_temp_path("mock-semantic-worker", "mjs");
    let definition_json = serde_json::to_string(&definition_path).unwrap();
    let completion_json = serde_json::to_string(&completion_labels).unwrap();
    fs::write(
        &path,
        format!(
            r#"
import readline from "node:readline";

const definitionPath = {definition_json};
const completionLabels = {completion_json};
const rl = readline.createInterface({{ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY }});

rl.on("line", (line) => {{
  const request = JSON.parse(line);
  let payload = {{}};
  if (request.method === "health") {{
    payload = {{ health: {{ status: "ok", protocolVersion: 3 }} }};
  }} else if (request.method === "gotoDefinition") {{
    const definition = definitionPath ? {{ path: definitionPath, line: 1, column: 17 }} : null;
    payload = {{ definition, definitionCandidates: definition ? [definition] : [] }};
  }} else if (request.method === "completion") {{
    payload = {{
      completion: completionLabels.map((label) => ({{
        label,
        detail: "Mock semantic item",
        kind: "function",
      }})),
    }};
  }}
  process.stdout.write(`${{JSON.stringify({{ id: request.id, ok: true, payload, error: null }})}}\n`);
}});
"#
        ),
    )
    .unwrap();

    MockWorker { path }
}

fn missing_sdk_settings() -> crate::services::settings_store::AppSettings {
    let mut settings = default_settings();
    settings.sdk.auto_detect = false;
    settings.sdk.harmony_sdk_path = "/tmp/arkline-missing-sdk".to_string();
    settings
}

fn sdk_settings(path: &str) -> crate::services::settings_store::AppSettings {
    let mut settings = default_settings();
    settings.sdk.auto_detect = false;
    settings.sdk.harmony_sdk_path = path.to_string();
    settings
}

fn with_worker_settings(
    mut settings: crate::services::settings_store::AppSettings,
    worker: &MockWorker,
) -> crate::services::settings_store::AppSettings {
    settings.sdk.semantic_worker_path = worker.path_text();
    settings
}

fn with_missing_sdk_env<T>(callback: impl FnOnce() -> T) -> T {
    let guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let scoped_env = ScopedSdkEnv {
        _guard: guard,
        previous: std::env::var(HARMONY_SDK_PATH_ENV).ok(),
    };
    std::env::set_var(HARMONY_SDK_PATH_ENV, "/tmp/arkline-missing-sdk");
    let result = callback();
    drop(scoped_env);
    result
}

fn with_valid_sdk_env<T>(callback: impl FnOnce(&std::path::Path) -> T) -> T {
    let guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let temp_sdk_root = std::env::temp_dir().join(format!(
        "arkline-valid-sdk-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos()
    ));
    fs::create_dir_all(temp_sdk_root.join("ets")).unwrap();
    fs::create_dir_all(temp_sdk_root.join("toolchains")).unwrap();
    let scoped_env = ScopedSdkEnv {
        _guard: guard,
        previous: std::env::var(HARMONY_SDK_PATH_ENV).ok(),
    };
    std::env::set_var(
        HARMONY_SDK_PATH_ENV,
        temp_sdk_root.to_string_lossy().to_string(),
    );
    let result = callback(&temp_sdk_root);
    fs::remove_dir_all(temp_sdk_root).unwrap();
    drop(scoped_env);
    result
}

#[test]
fn reports_skeleton_language_runtime() {
    with_missing_sdk_env(|| {
        let worker = mock_worker_entry(None, &[]);
        let runtime = LanguageRuntime::default();
        let settings = with_worker_settings(missing_sdk_settings(), &worker);
        let report = inspect_runtime(&runtime, &settings);

        assert_eq!(report.provider, "semantic-host");
        assert_eq!(report.mode, "semantic");
        assert!(report.running);
        assert!(!report.hover);
        assert!(report.definition);
        assert!(report.completion);
        assert!(report.document_symbols);
        assert!(report.find_usages);
        assert!(report.detail.contains("independent semantic worker"));
    });
}

#[test]
fn resolves_same_file_semantic_queries_without_sdk() {
    with_missing_sdk_env(|| {
        let worker = mock_worker_entry(None, &[]);
        let runtime = LanguageRuntime::default();
        let path = unique_temp_path("fallback-runtime", "ets");
        fs::write(
            &path,
            "@Entry\n@Component\nstruct Index {}\nfunction submit() {\n  Index;\n  submit();\n}\n",
        )
        .unwrap();
        let path_text = path.to_string_lossy().to_string();

        let settings = with_worker_settings(missing_sdk_settings(), &worker);
        assert!(hover_symbol(&runtime, &settings, &request(&path_text, 3, 9)).is_none());
        assert_eq!(
            goto_definition(&runtime, &settings, &request(&path_text, 5, 4)),
            Some(crate::models::language::DefinitionTarget {
                path: path_text.clone(),
                line: 3,
                column: 8,
            })
        );
        assert_eq!(
            goto_definition_candidates(&runtime, &settings, &request(&path_text, 5, 4)),
            vec![crate::models::language::DefinitionCandidate {
                path: path_text.clone(),
                line: 3,
                column: 8,
                preview: "struct Index {}".to_string(),
            }]
        );
        let completions = complete_symbol(&runtime, &settings, &request(&path_text, 1, 1));
        assert!(completions
            .iter()
            .any(|item| item.label == "@Entry" && item.kind == "keyword"));
        assert!(completions
            .iter()
            .any(|item| item.label == "@Component" && item.kind == "keyword"));
        assert!(completions
            .iter()
            .any(|item| item.label == "build()" && item.kind == "method"));
        assert!(completions
            .iter()
            .any(|item| item.label == "submit()" && item.kind == "function"));
        assert_eq!(
            list_document_symbols(&runtime, &settings, &request(&path_text, 1, 1)),
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
            find_usages(&runtime, &settings, &request(&path_text, 5, 4)),
            vec![
                crate::models::language::UsageResult {
                    path: path_text.clone(),
                    line: 3,
                    column: 8,
                    preview: "struct Index {}".to_string(),
                    kind: "fallback".to_string(),
                    confidence: "fallback".to_string(),
                },
                crate::models::language::UsageResult {
                    path: path_text.clone(),
                    line: 5,
                    column: 3,
                    preview: "Index;".to_string(),
                    kind: "fallback".to_string(),
                    confidence: "fallback".to_string(),
                },
            ]
        );

        fs::remove_file(path).unwrap();
    });
}

#[test]
fn keeps_semantic_mode_available_when_sdk_is_missing() {
    with_missing_sdk_env(|| {
        let worker = mock_worker_entry(None, &[]);
        let runtime = LanguageRuntime::default();
        let settings = with_worker_settings(missing_sdk_settings(), &worker);
        let report = inspect_runtime(&runtime, &settings);

        assert_eq!(report.mode, "semantic");
        assert_eq!(report.provider, "semantic-host");
        assert!(report.definition);
        assert!(report.completion);
        assert!(report.detail.contains("independent semantic worker"));
    });
}

#[test]
fn keeps_semantic_worker_active_when_sdk_discovery_fails() {
    with_missing_sdk_env(|| {
        let worker = mock_worker_entry(None, &[]);
        let runtime = LanguageRuntime::default();
        let settings = with_worker_settings(missing_sdk_settings(), &worker);
        let report = inspect_runtime(&runtime, &settings);

        assert_eq!(report.mode, "semantic");
        assert!(report.detail.contains("HarmonyOS SDK"));
        assert!(report.detail.contains("independent semantic worker"));
    });
}

#[test]
fn reports_semantic_mode_when_sdk_and_worker_are_available() {
    with_valid_sdk_env(|temp_sdk_root| {
        let worker = mock_worker_entry(None, &[]);
        let runtime = LanguageRuntime::default();
        let settings =
            with_worker_settings(sdk_settings(&temp_sdk_root.to_string_lossy()), &worker);
        let report = inspect_runtime(&runtime, &settings);

        assert_eq!(report.provider, "semantic-host");
        assert_eq!(report.mode, "semantic");
        assert!(report.running);
        assert!(report.definition);
        assert!(report.completion);
        assert!(report.document_symbols);
        assert!(report.find_usages);
        assert!(report.detail.contains("Semantic worker active"));
        assert!(report.detail.contains("SDK ready"));
    });
}

#[test]
fn resolves_cross_file_queries_in_semantic_mode() {
    with_valid_sdk_env(|temp_sdk_root| {
        let workspace_root = std::env::temp_dir().join(format!(
            "arkline-semantic-workspace-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after unix epoch")
                .as_nanos()
        ));
        let pages_dir = workspace_root.join("entry/src/main/ets/pages");
        let components_dir = workspace_root.join("entry/src/main/ets/components");
        fs::create_dir_all(&pages_dir).unwrap();
        fs::create_dir_all(&components_dir).unwrap();

        let shared_path = components_dir.join("Shared.ets");
        let index_path = pages_dir.join("Index.ets");
        fs::write(
            &shared_path,
            "export function sharedSubmit() {\n  return 1;\n}\n",
        )
        .unwrap();
        fs::write(
            &index_path,
            "import { sharedSubmit } from '../components/Shared';\n\nfunction buildPage() {\n  sharedSubmit();\n}\n",
        )
        .unwrap();

        let runtime = LanguageRuntime::default();
        let index_text = index_path.to_string_lossy().to_string();
        let shared_text = shared_path.to_string_lossy().to_string();
        let worker = mock_worker_entry(Some(&shared_text), &["sharedSubmit()"]);
        let settings =
            with_worker_settings(sdk_settings(&temp_sdk_root.to_string_lossy()), &worker);

        assert_eq!(
            goto_definition(&runtime, &settings, &request(&index_text, 4, 5)),
            Some(crate::models::language::DefinitionTarget {
                path: shared_text,
                line: 1,
                column: 17,
            })
        );
        assert!(
            complete_symbol(&runtime, &settings, &request(&index_text, 1, 1))
                .iter()
                .any(|item| item.label == "sharedSubmit()")
        );

        fs::remove_dir_all(workspace_root).unwrap();
    });
}

#[test]
fn forwards_sdk_definition_targets_from_semantic_worker() {
    with_valid_sdk_env(|temp_sdk_root| {
        let sdk_common_path = temp_sdk_root.join("ets/component/common.d.ts");
        fs::create_dir_all(sdk_common_path.parent().unwrap()).unwrap();
        fs::write(
            &sdk_common_path,
            "declare class CommonMethod<T> {\n  width(value: Length): T;\n}\n",
        )
        .unwrap();

        let source_path = unique_temp_path("arkui-width-source", "ets");
        fs::write(
            &source_path,
            "@Entry\n@Component\nstruct Index {\n  build() {\n    Column() {}\n      .width(100)\n  }\n}\n",
        )
        .unwrap();
        let source_text = source_path.to_string_lossy().to_string();
        let sdk_common_text = sdk_common_path.to_string_lossy().to_string();

        let runtime = LanguageRuntime::default();
        let worker = mock_worker_entry(Some(&sdk_common_text), &["width"]);
        let settings =
            with_worker_settings(sdk_settings(&temp_sdk_root.to_string_lossy()), &worker);

        assert_eq!(
            goto_definition(&runtime, &settings, &request(&source_text, 6, 8)),
            Some(crate::models::language::DefinitionTarget {
                path: sdk_common_text,
                line: 1,
                column: 17,
            })
        );

        fs::remove_file(source_path).unwrap();
    });
}
