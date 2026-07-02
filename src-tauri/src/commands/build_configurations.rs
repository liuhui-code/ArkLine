use crate::services::build_configuration_store::{
    load_build_configurations as load_build_configurations_from_store,
    save_build_configurations as save_build_configurations_to_store,
    BuildConfiguration,
};

#[tauri::command]
pub fn load_build_configurations(root_path: String) -> Result<Vec<BuildConfiguration>, String> {
    load_build_configurations_from_store(&root_path)
}

#[tauri::command]
pub fn save_build_configurations(
    root_path: String,
    configurations: Vec<BuildConfiguration>,
) -> Result<(), String> {
    save_build_configurations_to_store(&root_path, &configurations)
}
