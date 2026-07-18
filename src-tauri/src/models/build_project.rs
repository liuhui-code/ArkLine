use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyBuildProject {
    pub root_path: String,
    pub is_harmony_project: bool,
    pub has_hvigor_wrapper: bool,
    pub hvigor_wrapper_command: Option<String>,
    pub has_hvigor_file: bool,
    pub has_build_profile: bool,
    pub has_oh_package: bool,
    pub modules: Vec<String>,
    pub default_module: Option<String>,
}
