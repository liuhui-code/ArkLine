use crate::models::build_environment::{BuildEnvironmentRequest, BuildEnvironmentResolution};
use crate::services::build_environment_service::resolve_build_environment;

#[tauri::command]
pub fn resolve_build_environment_command(
    request: BuildEnvironmentRequest,
) -> Result<BuildEnvironmentResolution, String> {
    Ok(resolve_build_environment(&request))
}
