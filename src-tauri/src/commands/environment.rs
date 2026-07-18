use tauri::{AppHandle, State};

use crate::services::environment_doctor::{inspect_environment_with_launcher, EnvironmentReport};
use crate::services::language_service::LanguageRuntime;
use crate::services::settings_store::load_settings_for_app;

#[tauri::command]
pub fn inspect_environment(
    app: AppHandle,
    runtime: State<'_, LanguageRuntime>,
) -> Result<EnvironmentReport, String> {
    let settings = load_settings_for_app(&app)?;
    Ok(inspect_environment_with_launcher(
        &settings,
        runtime.launcher(),
    ))
}
