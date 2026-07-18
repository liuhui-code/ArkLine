use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSemanticLayerReadiness {
    pub layer: String,
    pub status: String,
    pub source_generation: Option<u64>,
    pub dependency_generation: Option<u64>,
    pub producer_version: Option<i64>,
    pub result_count: i64,
    pub error: Option<String>,
    pub updated_at: Option<i64>,
}

impl WorkspaceSemanticLayerReadiness {
    pub fn missing(layer: &str) -> Self {
        Self {
            layer: layer.to_string(),
            status: "missing".to_string(),
            source_generation: None,
            dependency_generation: None,
            producer_version: None,
            result_count: 0,
            error: None,
            updated_at: None,
        }
    }
}
