use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyProductSigning {
    pub product: String,
    pub signing_config: Option<String>,
    pub ready: bool,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyProductSdk {
    pub product: String,
    pub compile_sdk_version: Option<String>,
}

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
    pub products: Vec<String>,
    pub default_product: Option<String>,
    pub product_signing: Vec<HarmonyProductSigning>,
    pub product_sdks: Vec<HarmonyProductSdk>,
}
