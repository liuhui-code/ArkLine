use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettings {
    pub font_family: String,
    pub font_size: u8,
    pub line_height: f32,
    #[serde(default)]
    pub letter_spacing: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SdkSettings {
    #[serde(default)]
    pub harmony_sdk_path: String,
    #[serde(default)]
    pub semantic_worker_path: String,
    #[serde(default)]
    pub node_path: String,
    #[serde(default = "default_auto_detect")]
    pub auto_detect: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationSettings {
    pub format_on_save: bool,
    pub lint_command: String,
    pub format_command: String,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub editor: EditorSettings,
    #[serde(default = "default_sdk_settings")]
    pub sdk: SdkSettings,
    pub validation: ValidationSettings,
    #[serde(default)]
    pub recent_projects: Vec<String>,
}

fn default_auto_detect() -> bool {
    true
}

fn default_sdk_settings() -> SdkSettings {
    SdkSettings {
        harmony_sdk_path: String::new(),
        semantic_worker_path: String::new(),
        node_path: String::new(),
        auto_detect: true,
    }
}

pub fn default_settings() -> AppSettings {
    AppSettings {
        editor: EditorSettings {
            font_family: "Cascadia Code, JetBrains Mono, Consolas, monospace".to_string(),
            font_size: 14,
            line_height: 1.65,
            letter_spacing: 0.0,
        },
        sdk: default_sdk_settings(),
        validation: ValidationSettings {
            format_on_save: true,
            lint_command: "arklint".to_string(),
            format_command: "arkfmt".to_string(),
            timeout_ms: 5_000,
        },
        recent_projects: Vec::new(),
    }
}

pub fn read_settings(path: &Path) -> Result<AppSettings, String> {
    if !path.exists() {
        return Ok(default_settings());
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

pub fn load_settings_for_app(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_file_path(app)?;
    read_settings(&path)
}

pub fn write_settings_atomically(path: &Path, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let temp_path = temporary_settings_path(path);
    let payload = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;

    fs::write(&temp_path, payload).map_err(|error| error.to_string())?;
    fs::rename(temp_path, path).map_err(|error| error.to_string())
}

pub fn save_settings_for_app(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_file_path(app)?;
    write_settings_atomically(&path, settings)
}

fn temporary_settings_path(path: &Path) -> PathBuf {
    let file_name = path.file_name().and_then(|value| value.to_str()).unwrap_or("settings.json");
    path.with_file_name(format!("{file_name}.tmp"))
}

fn settings_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;

    Ok(config_dir.join("settings.json"))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{default_settings, read_settings, write_settings_atomically};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
    }

    #[test]
    fn returns_defaults_when_file_is_missing() {
        let path = unique_temp_dir("settings-missing").join("settings.json");
        let settings = read_settings(&path).unwrap();

        assert_eq!(settings, default_settings());
        assert_eq!(settings.editor.font_size, 14);
        assert_eq!(settings.editor.line_height, 1.65);
        assert_eq!(settings.editor.letter_spacing, 0.0);
        assert_eq!(settings.sdk.harmony_sdk_path, "");
        assert_eq!(settings.sdk.semantic_worker_path, "");
        assert_eq!(settings.sdk.node_path, "");
        assert!(settings.sdk.auto_detect);
    }

    #[test]
    fn rejects_malformed_json() {
        let root = unique_temp_dir("settings-bad-json");
        let path = root.join("settings.json");
        fs::create_dir_all(&root).unwrap();
        fs::write(&path, "{oops").unwrap();

        let error = read_settings(&path).unwrap_err();
        assert!(!error.is_empty());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn writes_settings_atomically() {
        let root = unique_temp_dir("settings-write");
        let path = root.join("settings.json");

        write_settings_atomically(&path, &default_settings()).unwrap();

        let settings = read_settings(&path).unwrap();
        assert_eq!(settings, default_settings());
        assert!(!path.with_file_name("settings.json.tmp").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preserves_sdk_and_editor_spacing_fields() {
        let root = unique_temp_dir("settings-sdk-write");
        let path = root.join("settings.json");
        let mut settings = default_settings();
        settings.editor.letter_spacing = 0.25;
        settings.sdk.harmony_sdk_path = "/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony".to_string();
        settings.sdk.semantic_worker_path = "/tmp/arkline-semantic-worker.mjs".to_string();
        settings.sdk.node_path = "/usr/local/bin/node".to_string();
        settings.sdk.auto_detect = false;

        write_settings_atomically(&path, &settings).unwrap();

        let loaded = read_settings(&path).unwrap();
        assert_eq!(loaded, settings);

        fs::remove_dir_all(root).unwrap();
    }
}
