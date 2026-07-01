use crate::models::workspace::{
    WorkspaceSearchCandidate, WorkspaceTextSearchOptions, WorkspaceTextSearchRequest,
};
use crate::services::workspace_index_query_service::search_workspace_text;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;

pub fn text_search_candidates(
    index_runtime: &WorkspaceIndexRuntime,
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSearchCandidate>, String> {
    let result = search_workspace_text(
        index_runtime,
        WorkspaceTextSearchRequest {
            root_path: root_path.to_string(),
            query: query.to_string(),
            options: WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: false,
            },
            limit,
            context_lines: 0,
        },
    )?;
    Ok(result
        .matches
        .into_iter()
        .enumerate()
        .map(|(index, matched)| WorkspaceSearchCandidate {
            id: format!("text:{}:{}:{}", matched.path, matched.line, matched.column),
            source: "text".to_string(),
            kind: "text".to_string(),
            title: matched.summary,
            subtitle: format!("{}:{}", matched.relative_path, matched.line),
            path: Some(matched.path),
            line: Some(matched.line),
            column: Some(matched.column),
            score: 20.0 - index as f64 * 0.01,
            freshness: "ready".to_string(),
            container: None,
            signature: Some(matched.preview),
            visibility: None,
        })
        .collect())
}
