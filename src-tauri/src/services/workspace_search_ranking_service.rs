use crate::models::workspace::WorkspaceSearchCandidate;

pub fn build_file_candidates(
    file_paths: &[String],
    query: &str,
    limit: usize,
    freshness: &str,
) -> Vec<WorkspaceSearchCandidate> {
    rank_paths(file_paths, query, limit)
        .into_iter()
        .map(|(path, score)| WorkspaceSearchCandidate {
            id: format!("file:{path}"),
            source: "file".to_string(),
            kind: "file".to_string(),
            title: file_name(&path),
            subtitle: path.clone(),
            path: Some(path),
            line: None,
            column: None,
            score,
            freshness: freshness.to_string(),
        })
        .collect()
}

pub fn sort_search_everywhere_candidates(
    candidates: &mut Vec<WorkspaceSearchCandidate>,
    limit: usize,
) {
    candidates.sort_by(|left, right| {
        source_priority(&left.source)
            .cmp(&source_priority(&right.source))
            .then_with(|| {
                right
                    .score
                    .partial_cmp(&left.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| left.title.cmp(&right.title))
    });
    candidates.truncate(limit);
}

fn source_priority(source: &str) -> usize {
    match source {
        "class" => 0,
        "symbol" => 1,
        "file" => 2,
        _ => 3,
    }
}

fn rank_paths(paths: &[String], query: &str, limit: usize) -> Vec<(String, f64)> {
    let trimmed = query.trim().to_lowercase();
    if trimmed.is_empty() {
        return paths
            .iter()
            .take(limit)
            .map(|path| (path.clone(), 0.0))
            .collect();
    }

    let mut ranked = paths
        .iter()
        .filter_map(|path| score_path(path, &trimmed).map(|score| (path.clone(), score)))
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.0.cmp(&right.0))
    });
    ranked.truncate(limit);
    ranked
}

fn score_path(path: &str, query: &str) -> Option<f64> {
    let lower_path = path.to_lowercase();
    let file_name = lower_path.rsplit(['\\', '/']).next().unwrap_or(&lower_path);
    let file_stem = file_name
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(file_name);
    let mut score = 0.0;
    let mut query_index = 0;
    let query_chars = query.chars().collect::<Vec<_>>();
    let mut run_length = 0.0;

    for character in lower_path.chars() {
        if query_index >= query_chars.len() {
            break;
        }

        if character != query_chars[query_index] {
            run_length = 0.0;
            continue;
        }

        score += 4.0;
        run_length += 1.0;
        query_index += 1;
        if run_length > 1.0 {
            score += 2.0;
        }
    }

    if query_index != query_chars.len() {
        return None;
    }

    if file_stem == query {
        score += 70.0;
    } else if file_name == query {
        score += 60.0;
    } else if file_name.starts_with(query) {
        score += 45.0;
    } else if file_name.contains(query) {
        score += 35.0;
    }

    if lower_path.contains(query) {
        score += 10.0;
    }

    Some(score - lower_path.len() as f64 * 0.01)
}

fn file_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_string()
}
