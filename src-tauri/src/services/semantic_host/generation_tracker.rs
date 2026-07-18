use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use super::protocol::SemanticReplayDocument;

const MAX_TRACKED_DOCUMENTS: usize = 512;
const MAX_REPLAY_DOCUMENTS: usize = 32;
const MAX_REPLAY_BYTES: usize = 4 * 1024 * 1024;
const MAX_SINGLE_REPLAY_BYTES: usize = 1024 * 1024;

#[derive(Default)]
pub struct SemanticDocumentGenerationTracker {
    documents: HashMap<String, TrackedDocument>,
    access_clock: u64,
}

struct TrackedDocument {
    content_hash: u64,
    generation: u64,
    replay_content: Option<String>,
    last_access: u64,
}

impl SemanticDocumentGenerationTracker {
    pub fn generation_for(&mut self, path: &str, content: Option<&str>) -> Option<u64> {
        let content = content?;
        let content_hash = hash_content(content);
        self.access_clock = self.access_clock.saturating_add(1);
        let replay_content =
            (content.len() <= MAX_SINGLE_REPLAY_BYTES).then(|| content.to_string());
        let generation = match self.documents.get_mut(path) {
            Some(document) if document.content_hash == content_hash => {
                document.last_access = self.access_clock;
                document.replay_content = replay_content;
                document.generation
            }
            Some(document) => {
                document.content_hash = content_hash;
                document.generation = document.generation.saturating_add(1);
                document.last_access = self.access_clock;
                document.replay_content = replay_content;
                document.generation
            }
            None => {
                self.documents.insert(
                    path.to_string(),
                    TrackedDocument {
                        content_hash,
                        generation: 1,
                        replay_content,
                        last_access: self.access_clock,
                    },
                );
                1
            }
        };
        self.trim(path);
        Some(generation)
    }

    pub fn replay_snapshot(&self) -> Vec<SemanticReplayDocument> {
        let mut documents = self
            .documents
            .iter()
            .filter_map(|(path, document)| {
                document.replay_content.as_ref().map(|content| {
                    (
                        document.last_access,
                        SemanticReplayDocument {
                            path: path.clone(),
                            content: content.clone(),
                            content_generation: document.generation,
                        },
                    )
                })
            })
            .collect::<Vec<_>>();
        documents.sort_by(|left, right| right.0.cmp(&left.0));
        documents
            .into_iter()
            .map(|(_, document)| document)
            .collect()
    }

    fn trim(&mut self, protected_path: &str) {
        trim_replay_content(&mut self.documents, protected_path);
        while self.documents.len() > MAX_TRACKED_DOCUMENTS {
            let candidate = self
                .documents
                .iter()
                .filter(|(path, _)| path.as_str() != protected_path)
                .min_by_key(|(_, document)| document.last_access)
                .map(|(path, _)| path.clone());
            let Some(path) = candidate else { break };
            self.documents.remove(&path);
        }
    }
}

fn trim_replay_content(documents: &mut HashMap<String, TrackedDocument>, protected_path: &str) {
    loop {
        let replay_count = documents
            .values()
            .filter(|document| document.replay_content.is_some())
            .count();
        let replay_bytes = documents
            .values()
            .filter_map(|document| document.replay_content.as_ref())
            .map(String::len)
            .sum::<usize>();
        if replay_count <= MAX_REPLAY_DOCUMENTS && replay_bytes <= MAX_REPLAY_BYTES {
            break;
        }
        let candidate = documents
            .iter()
            .filter(|(path, document)| {
                path.as_str() != protected_path && document.replay_content.is_some()
            })
            .min_by_key(|(_, document)| document.last_access)
            .map(|(path, _)| path.clone());
        let Some(path) = candidate else { break };
        if let Some(document) = documents.get_mut(&path) {
            document.replay_content = None;
        }
    }
}

fn hash_content(content: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::SemanticDocumentGenerationTracker;

    #[test]
    fn generation_changes_only_when_document_content_changes() {
        let mut tracker = SemanticDocumentGenerationTracker::default();
        assert_eq!(
            tracker.generation_for("/tmp/Index.ets", Some("one")),
            Some(1)
        );
        assert_eq!(
            tracker.generation_for("/tmp/Index.ets", Some("one")),
            Some(1)
        );
        assert_eq!(
            tracker.generation_for("/tmp/Index.ets", Some("two")),
            Some(2)
        );
        assert_eq!(
            tracker.generation_for("/tmp/Other.ets", Some("one")),
            Some(1)
        );
        assert_eq!(tracker.generation_for("/tmp/Index.ets", None), None);
    }

    #[test]
    fn replay_snapshot_keeps_latest_content_and_generation() {
        let mut tracker = SemanticDocumentGenerationTracker::default();
        tracker.generation_for("/tmp/Index.ets", Some("one"));
        tracker.generation_for("/tmp/Index.ets", Some("two"));

        let snapshot = tracker.replay_snapshot();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].content, "two");
        assert_eq!(snapshot[0].content_generation, 2);
    }

    #[test]
    fn replay_snapshot_is_bounded_to_hot_documents() {
        let mut tracker = SemanticDocumentGenerationTracker::default();
        for index in 0..40 {
            tracker.generation_for(&format!("/tmp/{index}.ets"), Some("content"));
        }

        let snapshot = tracker.replay_snapshot();
        assert_eq!(snapshot.len(), 32);
        assert_eq!(snapshot[0].path, "/tmp/39.ets");
        assert!(snapshot
            .iter()
            .all(|document| document.path != "/tmp/0.ets"));
    }
}
