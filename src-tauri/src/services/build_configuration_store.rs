use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuildConfiguration {
    pub id: String,
    pub name: String,
    pub target: String,
    pub module_name: String,
    pub product: String,
    pub build_mode: String,
    pub fast_mode: bool,
}

pub fn load_build_configurations(root_path: &str) -> Result<Vec<BuildConfiguration>, String> {
    let path = build_configurations_path(root_path);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

pub fn save_build_configurations(
    root_path: &str,
    configurations: &[BuildConfiguration],
) -> Result<(), String> {
    let path = build_configurations_path(root_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_vec_pretty(configurations).map_err(|error| error.to_string())?;
    let temp_path = temporary_path(&path);
    fs::write(&temp_path, payload).map_err(|error| error.to_string())?;
    fs::rename(temp_path, path).map_err(|error| error.to_string())
}

fn build_configurations_path(root_path: &str) -> PathBuf {
    Path::new(root_path)
        .join(".arkline")
        .join("build-configurations.json")
}

fn temporary_path(path: &Path) -> PathBuf {
    path.with_file_name("build-configurations.json.tmp")
}

#[cfg(test)]
mod tests {
    use super::super::workspace_index_test_fixture_service::unique_temp_dir;
    use super::{load_build_configurations, save_build_configurations, BuildConfiguration};

    #[test]
    fn returns_empty_configurations_when_file_is_missing() {
        let root = unique_temp_dir("build-config-missing");

        let configurations = load_build_configurations(&root.to_string_lossy()).unwrap();

        assert!(configurations.is_empty());
    }

    #[test]
    fn saves_and_loads_workspace_build_configurations() {
        let root = unique_temp_dir("build-config-write");
        let configuration = BuildConfiguration {
            id: "hap-entry-release".to_string(),
            name: "HAP entry release".to_string(),
            target: "hap".to_string(),
            module_name: "entry".to_string(),
            product: "default".to_string(),
            build_mode: "release".to_string(),
            fast_mode: false,
        };

        save_build_configurations(&root.to_string_lossy(), &[configuration.clone()]).unwrap();
        let configurations = load_build_configurations(&root.to_string_lossy()).unwrap();

        assert_eq!(configurations, vec![configuration]);
    }
}
