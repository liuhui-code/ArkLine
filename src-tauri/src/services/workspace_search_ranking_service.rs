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
            container: None,
            signature: None,
            visibility: None,
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

pub fn sort_text_candidates_by_lexical_match(
    candidates: &mut [WorkspaceSearchCandidate],
    query: &str,
) {
    let trimmed = query.trim();
    for (index, candidate) in candidates.iter_mut().enumerate() {
        candidate.score =
            score_text_candidate(candidate, trimmed).unwrap_or(20.0) - index as f64 * 0.01;
    }
    candidates.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.title.cmp(&right.title))
            .then_with(|| left.subtitle.cmp(&right.subtitle))
    });
}

fn source_priority(source: &str) -> usize {
    match source {
        "class" => 0,
        "symbol" => 1,
        "file" => 2,
        _ => 3,
    }
}

fn score_text_candidate(candidate: &WorkspaceSearchCandidate, query: &str) -> Option<f64> {
    if query.is_empty() {
        return None;
    }
    lexical_match_score(&candidate.title, query)
        .map(|score| score + 70.0)
        .or_else(|| {
            candidate
                .signature
                .as_ref()
                .and_then(|value| lexical_match_score(value, query).map(|score| score + 45.0))
        })
        .or_else(|| lexical_match_score(&candidate.subtitle, query).map(|score| score + 20.0))
        .or_else(|| {
            candidate
                .path
                .as_ref()
                .and_then(|path| lexical_match_score(path, query))
        })
}

fn rank_paths(paths: &[String], query: &str, limit: usize) -> Vec<(String, f64)> {
    let trimmed = query.trim();
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
    let raw_file_name = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let raw_file_stem = raw_file_name
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(raw_file_name);
    let lower_path = path.to_lowercase();
    let query = query.trim().to_lowercase();
    let mut score = lexical_match_score(raw_file_stem, &query)
        .or_else(|| lexical_match_score(raw_file_name, &query))
        .or_else(|| lexical_match_score(path, &query).map(|score| score - 40.0))?;

    if raw_file_stem.eq_ignore_ascii_case(&query) {
        score += 20.0;
    } else if raw_file_name.eq_ignore_ascii_case(&query) {
        score += 10.0;
    }

    if lower_path.contains(&query) {
        score += 10.0;
    }

    Some(score - lower_path.len() as f64 * 0.01)
}

pub fn lexical_match_score(value: &str, query: &str) -> Option<f64> {
    let trimmed = query.trim().to_lowercase();
    if trimmed.is_empty() {
        return None;
    }

    let lowered = value.to_lowercase();
    let mut score = fuzzy_score(&lowered, &trimmed)?;

    if lowered == trimmed {
        score += 120.0;
    } else if lowered.starts_with(&trimmed) {
        score += 95.0;
    } else if lowered.contains(&trimmed) {
        score += 75.0;
    } else if let Some(acronym) = camel_case_acronym(value) {
        if acronym == trimmed {
            score += 65.0;
        } else if acronym.starts_with(&trimmed) {
            score += 55.0;
        }
    }

    Some(score)
}

fn fuzzy_score(value: &str, query: &str) -> Option<f64> {
    let mut score = 0.0;
    let mut query_index = 0;
    let query_chars = query.chars().collect::<Vec<_>>();
    let mut run_length = 0.0;

    for character in value.chars() {
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

    Some(score)
}

fn file_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_string()
}

fn camel_case_acronym(value: &str) -> Option<String> {
    let mut acronym = String::new();
    let mut previous_was_separator = true;
    for character in value.chars() {
        if !character.is_ascii_alphanumeric() {
            previous_was_separator = true;
            continue;
        }
        if previous_was_separator || character.is_ascii_uppercase() {
            acronym.push(character.to_ascii_lowercase());
        }
        previous_was_separator = false;
    }
    (!acronym.is_empty()).then_some(acronym)
}
