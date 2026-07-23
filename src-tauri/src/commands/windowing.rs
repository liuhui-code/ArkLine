use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct LaunchWorkspaceState {
    paths: Mutex<HashMap<String, String>>,
}

impl LaunchWorkspaceState {
    pub fn for_process() -> Self {
        let state = Self::default();
        if let Some(root_path) = initial_workspace_path(
            std::env::args(),
            std::env::var("ARKLINE_WORKSPACE_ROOT").ok(),
        ) {
            state.set_for_label("main", root_path);
        }
        state
    }

    pub fn set_for_label(&self, label: &str, root_path: String) {
        self.paths
            .lock()
            .expect("launch workspace lock")
            .insert(label.to_string(), root_path);
    }

    pub fn get_for_label(&self, label: &str) -> Option<String> {
        self.paths
            .lock()
            .expect("launch workspace lock")
            .get(label)
            .cloned()
    }
}

fn initial_workspace_path(
    args: impl IntoIterator<Item = String>,
    environment_path: Option<String>,
) -> Option<String> {
    let mut arguments = args.into_iter();
    while let Some(argument) = arguments.next() {
        if argument == "--workspace" {
            return arguments.next().filter(|path| !path.trim().is_empty());
        }
        if let Some(path) = argument.strip_prefix("--workspace=") {
            if !path.trim().is_empty() {
                return Some(path.to_string());
            }
        }
    }
    environment_path.filter(|path| !path.trim().is_empty())
}

pub fn sanitize_window_label(root_path: &str) -> String {
    let sanitized = root_path
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    format!("workspace-{sanitized}")
}

#[tauri::command]
pub fn open_workspace_in_new_window(
    app: AppHandle,
    launch_state: State<LaunchWorkspaceState>,
    root_path: String,
) -> Result<(), String> {
    let label = format!(
        "{}-{}",
        sanitize_window_label(&root_path),
        uuid::Uuid::new_v4()
    );
    launch_state.set_for_label(&label, root_path);
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("ArkLine")
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_launch_workspace_path(
    window: tauri::Window,
    launch_state: State<LaunchWorkspaceState>,
) -> Result<Option<String>, String> {
    Ok(launch_state.get_for_label(window.label()))
}

#[cfg(test)]
mod tests {
    use super::{initial_workspace_path, sanitize_window_label, LaunchWorkspaceState};

    #[test]
    fn sanitizes_window_label_from_workspace_path() {
        assert!(sanitize_window_label("C:/samples/ArkDemo").starts_with("workspace-"));
    }

    #[test]
    fn stores_and_repeatedly_reads_launch_workspace_path() {
        let state = LaunchWorkspaceState::default();
        state.set_for_label("workspace-1", "C:/samples/ArkDemo".to_string());
        assert_eq!(
            state.get_for_label("workspace-1"),
            Some("C:/samples/ArkDemo".to_string())
        );
        assert_eq!(
            state.get_for_label("workspace-1"),
            Some("C:/samples/ArkDemo".to_string())
        );
    }

    #[test]
    fn resolves_explicit_workspace_before_environment_fallback() {
        let arguments = ["arkline", "--workspace", "C:/explicit"]
            .into_iter()
            .map(str::to_string);
        assert_eq!(
            initial_workspace_path(arguments, Some("C:/environment".to_string())),
            Some("C:/explicit".to_string())
        );
    }

    #[test]
    fn resolves_inline_workspace_and_environment_fallback() {
        assert_eq!(
            initial_workspace_path(
                ["arkline", "--workspace=C:/inline"]
                    .into_iter()
                    .map(str::to_string),
                None,
            ),
            Some("C:/inline".to_string())
        );
        assert_eq!(
            initial_workspace_path(
                ["arkline"].into_iter().map(str::to_string),
                Some("C:/environment".to_string()),
            ),
            Some("C:/environment".to_string())
        );
    }
}
