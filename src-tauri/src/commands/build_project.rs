use crate::models::build_project::HarmonyBuildProject;
use crate::services::build_project_service::{
    find_harmony_build_artifacts, inspect_harmony_build_project,
};

#[tauri::command]
pub fn inspect_harmony_build_project_command(
    root_path: String,
) -> Result<HarmonyBuildProject, String> {
    inspect_harmony_build_project(&root_path)
}

#[tauri::command]
pub fn find_harmony_build_artifacts_command(
    root_path: String,
    target: String,
    module_name: Option<String>,
    product: String,
) -> Result<Vec<String>, String> {
    find_harmony_build_artifacts(&root_path, &target, module_name.as_deref(), &product)
}
