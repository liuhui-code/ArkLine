use std::borrow::Cow;
use std::collections::HashSet;

use rusqlite::{params, Connection};

use crate::services::workspace_index_connection_service::open_existing_workspace_index_reader;
use crate::services::workspace_text_search_prefilter_service::plan_query_regex_prefilter;

pub(crate) struct RegexCandidatePathPlan<'a> {
    pub(crate) paths: Cow<'a, [String]>,
    pub(crate) index_skipped_files: usize,
}

pub(crate) fn plan_regex_candidate_paths<'a>(
    root_path: &str,
    query: &str,
    paths: &'a [String],
) -> Result<RegexCandidatePathPlan<'a>, String> {
    let Some(literal) = plan_query_regex_prefilter(query).and_then(|plan| plan.literal_hint) else {
        return Ok(unfiltered(paths));
    };
    let Some(connection) = open_existing_workspace_index_reader(root_path)? else {
        return Ok(unfiltered(paths));
    };
    let root_key = normalize_index_path(root_path);
    let ready = load_ready_substring_paths(&connection, &root_key)?;
    if ready.is_empty() {
        return Ok(unfiltered(paths));
    }
    let matching = load_matching_substring_paths(&connection, &root_key, &literal)?;
    let candidates = paths
        .iter()
        .filter(|path| {
            let path_key = normalize_index_path(path);
            !ready.contains(&path_key) || matching.contains(&path_key)
        })
        .cloned()
        .collect::<Vec<_>>();
    let index_skipped_files = paths.len().saturating_sub(candidates.len());
    if index_skipped_files == 0 {
        return Ok(unfiltered(paths));
    }
    Ok(RegexCandidatePathPlan {
        paths: Cow::Owned(candidates),
        index_skipped_files,
    })
}

fn load_ready_substring_paths(
    connection: &Connection,
    root_key: &str,
) -> Result<HashSet<String>, String> {
    load_paths(
        connection,
        "select core.path
         from workspace_content_files core
         join workspace_content_substring_files substring
           on substring.root_path = core.root_path and substring.path = core.path
         where core.root_path = ?1 and core.status = 'ready'
           and substring.status = 'ready'
           and substring.indexed_generation = core.indexed_generation",
        params![root_key],
    )
}

fn load_matching_substring_paths(
    connection: &Connection,
    root_key: &str,
    literal: &str,
) -> Result<HashSet<String>, String> {
    let fts_query = format!("\"{}\"", literal.replace('"', "\"\""));
    load_paths(
        connection,
        "select distinct trigram.path
         from workspace_content_trigram_fts trigram
         join workspace_content_substring_files substring
           on substring.root_path = trigram.root_path and substring.path = trigram.path
         join workspace_content_files core
           on core.root_path = trigram.root_path and core.path = trigram.path
         where trigram.root_path = ?1 and workspace_content_trigram_fts match ?2
           and substring.status = 'ready'
           and substring.indexed_generation = core.indexed_generation",
        params![root_key, fts_query],
    )
}

fn load_paths<P>(connection: &Connection, sql: &str, params: P) -> Result<HashSet<String>, String>
where
    P: rusqlite::Params,
{
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params, |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|error| error.to_string())
}

fn unfiltered(paths: &[String]) -> RegexCandidatePathPlan<'_> {
    RegexCandidatePathPlan {
        paths: Cow::Borrowed(paths),
        index_skipped_files: 0,
    }
}

fn normalize_index_path(path: &str) -> String {
    path.replace('/', "\\")
}

#[cfg(test)]
mod tests {
    use std::fs;

    use rusqlite::{params, Connection};

    use crate::services::workspace_content_index_service::index_workspace_content;
    use crate::services::workspace_index_test_fixture_service::{
        create_empty_workspace, create_workspace_source_dir,
    };

    use super::plan_regex_candidate_paths;

    #[test]
    fn regex_literal_uses_substring_index_to_exclude_ready_noise_files() {
        let root = create_empty_workspace("regex-candidate-paths");
        let source_dir = create_workspace_source_dir(&root);
        let matching = source_dir.join("Matching.ets");
        let noise = source_dir.join("Noise.ets");
        fs::write(&matching, "Text(\"ArkLine\").width(100)").unwrap();
        fs::write(&noise, "Button(\"Other\")").unwrap();
        let root_path = root.to_string_lossy().to_string();
        let paths = vec![
            matching.to_string_lossy().to_string(),
            noise.to_string_lossy().to_string(),
        ];
        index_workspace_content(&root_path, &paths).unwrap();

        let plan =
            plan_regex_candidate_paths(&root_path, "/Text\\(\"ArkLine\"\\)\\.width/", &paths)
                .unwrap();

        assert_eq!(plan.paths.as_ref(), &[paths[0].clone()]);
        assert_eq!(plan.index_skipped_files, 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn regex_literal_keeps_pending_substring_files_in_the_verification_set() {
        let root = create_empty_workspace("regex-candidate-pending");
        let source_dir = create_workspace_source_dir(&root);
        let matching = source_dir.join("Matching.ets");
        let pending = source_dir.join("Pending.ets");
        fs::write(&matching, "Text(\"ArkLine\").width(100)").unwrap();
        fs::write(&pending, "Button(\"Other\")").unwrap();
        let root_path = root.to_string_lossy().to_string();
        let paths = vec![
            matching.to_string_lossy().to_string(),
            pending.to_string_lossy().to_string(),
        ];
        index_workspace_content(&root_path, &paths).unwrap();
        let connection =
            Connection::open(root.join(".arkline/index/workspace-catalog.sqlite")).unwrap();
        connection
            .execute(
                "update workspace_content_substring_files set status = 'pending'
                 where path = ?1",
                params![pending.to_string_lossy().replace('/', "\\")],
            )
            .unwrap();
        drop(connection);

        let plan =
            plan_regex_candidate_paths(&root_path, "/Text\\(\"ArkLine\"\\)\\.width/", &paths)
                .unwrap();

        assert_eq!(plan.paths.as_ref(), paths.as_slice());
        assert_eq!(plan.index_skipped_files, 0);
        fs::remove_dir_all(root).unwrap();
    }
}
