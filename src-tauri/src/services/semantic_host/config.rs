use crate::services::settings_store::AppSettings;

use super::sdk::HARMONY_SDK_PATH_ENV;

pub const DISABLED_SDK_SENTINEL: &str = "__ARKLINE_SDK_DISABLED__";

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SemanticHostConfig {
    pub harmony_sdk_path: Option<String>,
    pub harmony_sdk_auto_detect: bool,
    pub semantic_worker_path: Option<String>,
    pub node_path: Option<String>,
}

impl SemanticHostConfig {
    pub fn from_settings(settings: &AppSettings) -> Self {
        Self {
            harmony_sdk_path: trim_to_option(&settings.sdk.harmony_sdk_path),
            harmony_sdk_auto_detect: settings.sdk.auto_detect,
            semantic_worker_path: trim_to_option(&settings.sdk.semantic_worker_path),
            node_path: trim_to_option(&settings.sdk.node_path),
        }
    }

    pub fn harmony_sdk_env_value(&self) -> Option<String> {
        match (
            self.harmony_sdk_auto_detect,
            self.harmony_sdk_path.as_deref(),
        ) {
            (_, Some(path)) => Some(path.to_string()),
            (false, None) => Some(DISABLED_SDK_SENTINEL.to_string()),
            (true, None) => None,
        }
    }

    pub fn apply_to_process_env(&self) {
        apply_optional_env(
            HARMONY_SDK_PATH_ENV,
            self.harmony_sdk_env_value().as_deref(),
        );
        apply_optional_env(
            super::process::ARKLINE_NODE_PATH_ENV,
            self.node_path.as_deref(),
        );
        apply_optional_env(
            super::process::ARKLINE_SEMANTIC_WORKER_ENTRY_ENV,
            self.semantic_worker_path.as_deref(),
        );
    }
}

fn trim_to_option(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn apply_optional_env(name: &str, value: Option<&str>) {
    if let Some(value) = value {
        std::env::set_var(name, value);
    } else {
        std::env::remove_var(name);
    }
}
