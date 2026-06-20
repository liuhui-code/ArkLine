use serde::Serialize;
use std::process::Command;

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
    EnvironmentReport {
        tools: vec![
            detect_command("git", &["--version"]),
            detect_command("rg", &["--version"]),
            detect_command_label("lintCommand", &settings.validation.lint_command, &["--version"]),
            detect_command_label("formatCommand", &settings.validation.format_command, &["--version"]),
            ToolStatus {
                name: "arktsLanguageServer".to_string(),
                available: false,
                detail: "Not bundled yet".to_string(),
            },
            ToolStatus {
                name: "webview2".to_string(),
                available: true,
                detail: "Installer enforces minimum version on Windows".to_string(),
            },
        ],
    }
}

fn detect_command_label(name: &str, command: &str, args: &[&str]) -> ToolStatus {
    match Command::new(command).args(args).output() {
        Ok(output) if output.status.success() => ToolStatus {
            name: name.to_string(),
            available: true,
            detail: format!("{command}: {}", String::from_utf8_lossy(&output.stdout).trim()),
        },
        Ok(output) => ToolStatus {
            name: name.to_string(),
            available: false,
            detail: format!("{command}: {}", String::from_utf8_lossy(&output.stderr).trim()),
        },
        Err(error) => ToolStatus {
            name: name.to_string(),
            available: false,
            detail: format!("{command}: {error}"),
        },
    }
}

fn detect_command(command: &str, args: &[&str]) -> ToolStatus {
    match Command::new(command).args(args).output() {
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

#[cfg(test)]
mod tests {
    use crate::services::settings_store::default_settings;

    use super::inspect_environment;

    #[test]
    fn reports_known_tools_and_runtime_assumptions() {
        let report = inspect_environment(&default_settings());

        assert!(report.tools.iter().any(|tool| tool.name == "git"));
        assert!(report.tools.iter().any(|tool| tool.name == "rg"));
        assert!(report.tools.iter().any(|tool| tool.name == "lintCommand"));
        assert!(report.tools.iter().any(|tool| tool.name == "formatCommand"));
        assert!(report.tools.iter().any(|tool| tool.name == "webview2"));
    }
}
