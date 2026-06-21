use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct LaunchWorkspaceState {
    paths: Mutex<HashMap<String, String>>,
}

impl LaunchWorkspaceState {
    pub fn set_for_label(&self, label: &str, root_path: String) {
        self.paths
            .lock()
            .expect("launch workspace lock")
            .insert(label.to_string(), root_path);
    }

    pub fn take_for_label(&self, label: &str) -> Option<String> {
        self.paths
            .lock()
            .expect("launch workspace lock")
            .remove(label)
    }
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
    let label = format!("{}-{}", sanitize_window_label(&root_path), uuid::Uuid::new_v4());
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
    Ok(launch_state.take_for_label(window.label()))
}

#[cfg(test)]
mod tests {
    use super::{sanitize_window_label, LaunchWorkspaceState};

    #[test]
    fn sanitizes_window_label_from_workspace_path() {
        assert!(sanitize_window_label("C:/samples/ArkDemo").starts_with("workspace-"));
    }

    #[test]
    fn stores_and_reads_launch_workspace_path() {
        let state = LaunchWorkspaceState::default();
        state.set_for_label("workspace-1", "C:/samples/ArkDemo".to_string());
        assert_eq!(
            state.take_for_label("workspace-1"),
            Some("C:/samples/ArkDemo".to_string())
        );
    }
}
