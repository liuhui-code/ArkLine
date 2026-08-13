use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildEnvironmentRequest {
    pub root_path: String,
    pub harmony_sdk_path: String,
    pub node_path: String,
    pub auto_detect: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildEnvironmentCheck {
    pub name: String,
    pub available: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildEnvironmentResolution {
    pub can_build: bool,
    pub hvigor_command: Option<String>,
    pub hvigor_source: Option<String>,
    pub node_path: Option<String>,
    pub sdk_path: Option<String>,
    pub path_entries: Vec<String>,
    pub environment: HashMap<String, String>,
    pub checks: Vec<BuildEnvironmentCheck>,
}
