#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImportRow {
    pub(crate) from_path: String,
    pub(crate) source_module: String,
    pub(crate) line: usize,
    pub(crate) column: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DependencyExpansion {
    Expanded(Vec<String>),
    LimitExceeded,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DependencyGraphStatus {
    pub status: String,
    pub reason: Option<String>,
}
