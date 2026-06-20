use tauri::AppHandle;

use crate::services::settings_store::{load_settings_for_app, save_settings_for_app, AppSettings};

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    load_settings_for_app(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    save_settings_for_app(&app, &settings)
}
