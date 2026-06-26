use tauri::AppHandle;

use crate::services::environment_doctor::{
    inspect_environment as inspect_environment_impl, EnvironmentReport,
};
use crate::services::settings_store::load_settings_for_app;

#[tauri::command]
pub fn inspect_environment(app: AppHandle) -> Result<EnvironmentReport, String> {
    let settings = load_settings_for_app(&app)?;
    Ok(inspect_environment_impl(&settings))
}
