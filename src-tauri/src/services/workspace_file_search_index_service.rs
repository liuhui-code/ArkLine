use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use crate::models::workspace::WorkspaceSearchCandidate;
use crate::services::workspace_search_ranking_service::{
    camel_case_acronym, lexical_match_score_prepared,
};

const MAX_QUERY_CANDIDATES: usize = 512;
const MAX_ACRONYM_PREFIX_CHARS: usize = 16;

#[derive(Debug)]
struct FileSearchEntry {
    path: String,
    file_name: String,
    lower_path: String,
    lower_file_name: String,
    lower_file_stem: String,
    acronym: Option<String>,
}

#[derive(Debug, Default)]
pub(crate) struct WorkspaceFileSearchIndex {
    entries: Vec<FileSearchEntry>,
    exact_stems: HashMap<String, Vec<usize>>,
    stem_order: Vec<usize>,
    acronym_prefixes: HashMap<String, Vec<usize>>,
    stem_trigrams: HashMap<u32, Vec<usize>>,
}

#[derive(Debug)]
pub(crate) struct WorkspaceFileSearchQueryResult {
    pub(crate) candidates: Vec<WorkspaceSearchCandidate>,
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) scored_path_count: usize,
}

impl WorkspaceFileSearchIndex {
    pub(crate) fn new<I>(paths: I) -> Self
    where
        I: IntoIterator<Item = String>,
    {
        let mut index = Self::default();
        for path in paths {
            index.insert(path);
        }
        index.stem_order = (0..index.entries.len()).collect();
        index.stem_order.sort_unstable_by(|left, right| {
            index.entries[*left]
                .lower_file_stem
                .cmp(&index.entries[*right].lower_file_stem)
                .then_with(|| index.entries[*left].path.cmp(&index.entries[*right].path))
        });
        index
    }

    pub(crate) fn query(
        &self,
        query: &str,
        limit: usize,
        freshness: &str,
    ) -> Vec<WorkspaceSearchCandidate> {
        self.query_with_metrics(query, limit, freshness).candidates
    }

    pub(crate) fn query_with_metrics(
        &self,
        query: &str,
        limit: usize,
        freshness: &str,
    ) -> WorkspaceFileSearchQueryResult {
        let normalized_query = query.trim().replace('\\', "/").to_lowercase();
        if normalized_query.is_empty() {
            return WorkspaceFileSearchQueryResult {
                candidates: self
                    .entries
                    .iter()
                    .take(limit)
                    .map(|entry| candidate(entry, 0.0, freshness))
                    .collect(),
                scored_path_count: 0,
            };
        }

        let (directory_query, file_query) = normalized_query
            .rsplit_once('/')
            .map(|(directory, file)| (Some(directory), file))
            .unwrap_or((None, normalized_query.as_str()));
        let candidate_ids = self.candidate_ids(file_query);
        let scored_path_count = candidate_ids.len();
        let mut scored = candidate_ids
            .into_iter()
            .filter_map(|entry_id| {
                let entry = &self.entries[entry_id];
                score_entry(entry, &normalized_query, file_query, directory_query)
                    .map(|score| (entry_id, score))
            })
            .collect::<Vec<_>>();
        retain_top_matches(&mut scored, limit, &self.entries);
        let candidates = scored
            .into_iter()
            .map(|(entry_id, score)| candidate(&self.entries[entry_id], score, freshness))
            .collect();
        WorkspaceFileSearchQueryResult {
            candidates,
            scored_path_count,
        }
    }

    fn insert(&mut self, path: String) {
        let file_name = path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string();
        let file_stem = file_name
            .rsplit_once('.')
            .map(|(stem, _)| stem)
            .unwrap_or(&file_name)
            .to_string();
        let entry = FileSearchEntry {
            lower_path: path.replace('\\', "/").to_lowercase(),
            lower_file_name: file_name.to_lowercase(),
            lower_file_stem: file_stem.to_lowercase(),
            acronym: camel_case_acronym(&file_stem),
            path,
            file_name,
        };
        let entry_id = self.entries.len();
        append_posting(
            &mut self.exact_stems,
            entry.lower_file_stem.clone(),
            entry_id,
        );
        if let Some(acronym) = &entry.acronym {
            index_prefixes(&mut self.acronym_prefixes, acronym, entry_id);
        }
        for trigram in unique_trigrams(entry.lower_file_stem.as_bytes()) {
            self.stem_trigrams
                .entry(trigram)
                .or_default()
                .push(entry_id);
        }
        self.entries.push(entry);
    }

    fn candidate_ids(&self, query: &str) -> Vec<usize> {
        let mut result = Vec::new();
        let mut seen = HashSet::new();
        append_candidates(&mut result, &mut seen, self.exact_stems.get(query));
        self.append_stem_prefix_candidates(query, &mut result, &mut seen);
        append_candidates(&mut result, &mut seen, self.acronym_prefixes.get(query));
        if result.len() < MAX_QUERY_CANDIDATES {
            let trigram_matches = self.intersect_trigram_postings(query.as_bytes());
            append_candidates(&mut result, &mut seen, trigram_matches.as_ref());
        }
        if result.is_empty() {
            let fallback_prefix = char_prefix(query, query.chars().count().min(2));
            self.append_stem_prefix_candidates(&fallback_prefix, &mut result, &mut seen);
        }
        result
    }

    fn append_stem_prefix_candidates(
        &self,
        query: &str,
        result: &mut Vec<usize>,
        seen: &mut HashSet<usize>,
    ) {
        let start = self
            .stem_order
            .partition_point(|entry_id| self.entries[*entry_id].lower_file_stem.as_str() < query);
        for entry_id in self.stem_order.iter().skip(start) {
            if !self.entries[*entry_id].lower_file_stem.starts_with(query) {
                break;
            }
            if seen.insert(*entry_id) {
                result.push(*entry_id);
                if result.len() == MAX_QUERY_CANDIDATES {
                    break;
                }
            }
        }
    }

    fn intersect_trigram_postings(&self, query: &[u8]) -> Option<Vec<usize>> {
        let trigrams = unique_trigrams(query);
        if trigrams.is_empty() {
            return None;
        }
        let mut postings = trigrams
            .iter()
            .map(|trigram| self.stem_trigrams.get(trigram))
            .collect::<Option<Vec<_>>>()?;
        postings.sort_by_key(|posting| posting.len());
        let matches = postings[0]
            .iter()
            .copied()
            .filter(|entry_id| {
                postings
                    .iter()
                    .skip(1)
                    .all(|posting| posting.binary_search(entry_id).is_ok())
            })
            .take(MAX_QUERY_CANDIDATES)
            .collect();
        Some(matches)
    }
}

fn append_posting(postings: &mut HashMap<String, Vec<usize>>, key: String, entry_id: usize) {
    postings.entry(key).or_default().push(entry_id);
}

fn index_prefixes(postings: &mut HashMap<String, Vec<usize>>, value: &str, entry_id: usize) {
    let mut prefix = String::new();
    for character in value.chars().take(MAX_ACRONYM_PREFIX_CHARS) {
        prefix.push(character);
        append_posting(postings, prefix.clone(), entry_id);
    }
}

fn append_candidates(
    result: &mut Vec<usize>,
    seen: &mut HashSet<usize>,
    candidates: Option<&Vec<usize>>,
) {
    let Some(candidates) = candidates else {
        return;
    };
    for entry_id in candidates {
        if seen.insert(*entry_id) {
            result.push(*entry_id);
            if result.len() == MAX_QUERY_CANDIDATES {
                return;
            }
        }
    }
}

fn unique_trigrams(value: &[u8]) -> Vec<u32> {
    if value.len() < 3 {
        return Vec::new();
    }
    let mut trigrams = value
        .windows(3)
        .map(|window| ((window[0] as u32) << 16) | ((window[1] as u32) << 8) | window[2] as u32)
        .collect::<Vec<_>>();
    trigrams.sort_unstable();
    trigrams.dedup();
    trigrams
}

fn char_prefix(value: &str, length: usize) -> String {
    value.chars().take(length).collect()
}

fn score_entry(
    entry: &FileSearchEntry,
    query: &str,
    file_query: &str,
    directory_query: Option<&str>,
) -> Option<f64> {
    if directory_query.is_some_and(|directory| !entry.lower_path.contains(directory)) {
        return None;
    }
    let mut score =
        lexical_match_score_prepared(&entry.lower_file_stem, entry.acronym.as_deref(), file_query)
            .or_else(|| lexical_match_score_prepared(&entry.lower_file_name, None, file_query))
            .or_else(|| {
                lexical_match_score_prepared(&entry.lower_path, None, query)
                    .map(|value| value - 40.0)
            })?;
    if entry.lower_file_stem == file_query {
        score += 20.0;
    } else if entry.lower_file_name == file_query {
        score += 10.0;
    }
    if entry.lower_path.contains(query) {
        score += 10.0;
    }
    if directory_query.is_some() {
        score += 25.0;
    }
    Some(score - entry.lower_path.len() as f64 * 0.01)
}

fn retain_top_matches(scored: &mut Vec<(usize, f64)>, limit: usize, entries: &[FileSearchEntry]) {
    if limit == 0 {
        scored.clear();
        return;
    }
    if scored.len() > limit {
        scored.select_nth_unstable_by(limit, |left, right| compare_match(left, right, entries));
        scored.truncate(limit);
    }
    scored.sort_by(|left, right| compare_match(left, right, entries));
}

fn compare_match(
    left: &(usize, f64),
    right: &(usize, f64),
    entries: &[FileSearchEntry],
) -> Ordering {
    right
        .1
        .partial_cmp(&left.1)
        .unwrap_or(Ordering::Equal)
        .then_with(|| entries[left.0].path.cmp(&entries[right.0].path))
}

fn candidate(entry: &FileSearchEntry, score: f64, freshness: &str) -> WorkspaceSearchCandidate {
    WorkspaceSearchCandidate {
        id: format!("file:{}", entry.path),
        source: "file".to_string(),
        kind: "file".to_string(),
        title: entry.file_name.clone(),
        subtitle: entry.path.clone(),
        path: Some(entry.path.clone()),
        line: None,
        column: None,
        score,
        freshness: freshness.to_string(),
        container: None,
        signature: None,
        visibility: None,
    }
}
