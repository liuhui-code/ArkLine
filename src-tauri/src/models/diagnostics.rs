use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationProblem {
    pub source: String,
    pub severity: String,
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub message: String,
}
