use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceIndexLayerStatus {
    Ready,
    Partial,
    Stale,
    Failed,
    Missing,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexLayerReadiness {
    pub layer: String,
    pub workspace_status: WorkspaceIndexLayerStatus,
    pub current_file_status: Option<WorkspaceIndexLayerStatus>,
    pub indexed_count: i64,
    pub failed_count: i64,
    pub stale_count: i64,
    pub reason: Option<String>,
    pub recommended_action: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexLayerReadinessReport {
    pub root_path: String,
    pub current_file_path: Option<String>,
    pub layers: Vec<WorkspaceIndexLayerReadiness>,
}

impl WorkspaceIndexLayerReadinessReport {
    #[cfg(test)]
    pub fn layer(&self, layer: &str) -> Option<&WorkspaceIndexLayerReadiness> {
        self.layers.iter().find(|item| item.layer == layer)
    }
}
