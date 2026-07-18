use serde::Serialize;

use crate::services::process_command_service::hidden_command;
use crate::services::semantic::arkts_lsp_provider::ArkTsLspProvider;
use crate::services::semantic_host::config::SemanticHostConfig;
use crate::services::semantic_host::launcher::{
    direct_semantic_worker_launcher, SharedSemanticWorkerLauncher,
};
use crate::services::semantic_host::manager::SemanticHostReadiness;
use crate::services::semantic_host::sdk::{discover_harmony_sdk, SdkDiscovery};
use crate::services::semantic_host::supervisor::semantic_memory_budget_bytes;
use crate::services::settings_store::AppSettings;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub name: String,
    pub available: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReport {
    pub tools: Vec<ToolStatus>,
}

pub fn inspect_environment(settings: &AppSettings) -> EnvironmentReport {
    inspect_environment_with_launcher(settings, direct_semantic_worker_launcher())
}

pub fn inspect_environment_with_launcher(
    settings: &AppSettings,
    launcher: SharedSemanticWorkerLauncher,
) -> EnvironmentReport {
    EnvironmentReport {
        tools: vec![
            detect_command("git", &["--version"]),
            detect_command("rg", &["--version"]),
            detect_command_label(
                "lintCommand",
                &settings.validation.lint_command,
                &["--version"],
            ),
            detect_command_label(
                "formatCommand",
                &settings.validation.format_command,
                &["--version"],
            ),
            detect_harmony_sdk(settings),
            detect_semantic_worker(settings, launcher.clone()),
            detect_arkts_language_server(settings, launcher),
            ToolStatus {
                name: "webview2".to_string(),
                available: true,
                detail: "Installer enforces minimum version on Windows".to_string(),
            },
        ],
    }
}

fn detect_command_label(name: &str, command: &str, args: &[&str]) -> ToolStatus {
    match hidden_command(command).args(args).output() {
        Ok(output) if output.status.success() => ToolStatus {
            name: name.to_string(),
            available: true,
            detail: format!(
                "{command}: {}",
                String::from_utf8_lossy(&output.stdout).trim()
            ),
        },
        Ok(output) => ToolStatus {
            name: name.to_string(),
            available: false,
            detail: format!(
                "{command}: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        },
        Err(error) => ToolStatus {
            name: name.to_string(),
            available: false,
            detail: format!("{command}: {error}"),
        },
    }
}

fn detect_command(command: &str, args: &[&str]) -> ToolStatus {
    match hidden_command(command).args(args).output() {
        Ok(output) if output.status.success() => ToolStatus {
            name: command.to_string(),
            available: true,
            detail: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        },
        Ok(output) => ToolStatus {
            name: command.to_string(),
            available: false,
            detail: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        },
        Err(error) => ToolStatus {
            name: command.to_string(),
            available: false,
            detail: error.to_string(),
        },
    }
}

fn detect_harmony_sdk(settings: &AppSettings) -> ToolStatus {
    let config = SemanticHostConfig::from_settings(settings);
    match discover_harmony_sdk(config.harmony_sdk_env_value().as_deref()) {
        SdkDiscovery::Ready(path) => ToolStatus {
            name: "harmonySdk".to_string(),
            available: true,
            detail: format!("HarmonyOS SDK ready at {}", path.display()),
        },
        SdkDiscovery::Missing => ToolStatus {
            name: "harmonySdk".to_string(),
            available: false,
            detail: "Set ARKLINE_HARMONY_SDK_PATH to your HarmonyOS SDK root".to_string(),
        },
    }
}

fn detect_semantic_worker(
    settings: &AppSettings,
    launcher: SharedSemanticWorkerLauncher,
) -> ToolStatus {
    let readiness = SemanticHostReadiness::discover_with_launcher(
        SemanticHostConfig::from_settings(settings),
        launcher,
    );

    ToolStatus {
        name: "semanticWorker".to_string(),
        available: readiness.is_ready(),
        detail: format!(
            "{}; memory budget {} MiB",
            readiness.worker.detail,
            semantic_memory_budget_bytes() / 1024 / 1024
        ),
    }
}

fn detect_arkts_language_server(
    settings: &AppSettings,
    launcher: SharedSemanticWorkerLauncher,
) -> ToolStatus {
    let discovery = ArkTsLspProvider::discovery_with_launcher(
        SemanticHostConfig::from_settings(settings),
        launcher,
    );

    ToolStatus {
        name: "arktsLanguageServer".to_string(),
        available: discovery.binary_path.is_some(),
        detail: discovery.detail,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::services::settings_store::default_settings;

    use super::inspect_environment;

    fn unique_temp_path(name: &str, extension: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-{name}-{suffix}.{extension}"))
    }

    #[test]
    fn reports_known_tools_and_runtime_assumptions() {
        let report = inspect_environment(&default_settings());

        assert!(report.tools.iter().any(|tool| tool.name == "git"));
        assert!(report.tools.iter().any(|tool| tool.name == "rg"));
        assert!(report.tools.iter().any(|tool| tool.name == "lintCommand"));
        assert!(report.tools.iter().any(|tool| tool.name == "formatCommand"));
        assert!(report.tools.iter().any(|tool| tool.name == "harmonySdk"));
        assert!(report
            .tools
            .iter()
            .any(|tool| tool.name == "semanticWorker"));
        assert!(report.tools.iter().any(|tool| tool.name == "webview2"));
    }

    #[test]
    fn environment_inspection_does_not_start_semantic_worker() {
        let worker_entry = unique_temp_path("inspect-worker", "mjs");
        let marker_path = unique_temp_path("inspect-worker-started", "txt");
        fs::write(
            &worker_entry,
            format!(
                r#"
import fs from "node:fs";
fs.writeFileSync({}, "started");
"#,
                serde_json::to_string(&marker_path.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
        let mut settings = default_settings();
        settings.sdk.semantic_worker_path = worker_entry.to_string_lossy().to_string();

        let report = inspect_environment(&settings);

        assert!(report
            .tools
            .iter()
            .any(|tool| tool.name == "arktsLanguageServer"));
        assert!(!marker_path.exists());

        fs::remove_file(worker_entry).unwrap();
    }
}
