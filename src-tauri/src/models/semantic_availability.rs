use serde::Serialize;

use super::language::{CodeActionResolution, UsageResult};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SemanticAvailability {
    Ready,
    Partial,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageQueryResult {
    pub availability: SemanticAvailability,
    pub items: Vec<UsageResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl UsageQueryResult {
    pub fn ready(items: Vec<UsageResult>) -> Self {
        Self {
            availability: SemanticAvailability::Ready,
            items,
            message: None,
        }
    }

    pub fn partial(items: Vec<UsageResult>, message: impl Into<String>) -> Self {
        Self {
            availability: SemanticAvailability::Partial,
            items,
            message: Some(message.into()),
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            availability: SemanticAvailability::Unavailable,
            items: Vec::new(),
            message: Some(message.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenameSymbolResult {
    pub availability: SemanticAvailability,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<CodeActionResolution>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl RenameSymbolResult {
    pub fn ready(resolution: CodeActionResolution) -> Self {
        Self {
            availability: SemanticAvailability::Ready,
            resolution: Some(resolution),
            message: None,
        }
    }

    pub fn partial(resolution: CodeActionResolution, message: impl Into<String>) -> Self {
        Self {
            availability: SemanticAvailability::Partial,
            resolution: Some(resolution),
            message: Some(message.into()),
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            availability: SemanticAvailability::Unavailable,
            resolution: None,
            message: Some(message.into()),
        }
    }
}
