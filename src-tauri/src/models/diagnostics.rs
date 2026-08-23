use serde::{Deserialize, Serialize};

use super::semantic_availability::SemanticAvailability;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationProblem {
    pub source: String,
    pub severity: String,
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<ValidationFix>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationFix {
    pub title: String,
    pub start_line: usize,
    pub start_column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub replacement: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationQueryResult {
    pub availability: SemanticAvailability,
    pub items: Vec<ValidationProblem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl ValidationQueryResult {
    pub fn ready(items: Vec<ValidationProblem>) -> Self {
        Self {
            availability: SemanticAvailability::Ready,
            items,
            message: None,
        }
    }

    pub fn partial(items: Vec<ValidationProblem>, message: impl Into<String>) -> Self {
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
