use crate::models::build_project::HarmonyBuildProject;
use crate::services::build_project_service::inspect_harmony_build_project;

#[tauri::command]
pub fn inspect_harmony_build_project_command(
    root_path: String,
) -> Result<HarmonyBuildProject, String> {
    inspect_harmony_build_project(&root_path)
}
