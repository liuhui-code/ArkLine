use std::collections::BTreeMap;

use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;

const MAX_TRACKED_ROOTS: usize = 32;
// The scheduler performs latest-wins merging. These short windows only keep a
// burst of UI hints from repeatedly waking the worker before that merge occurs.
const VISIBLE_FILES_COOLDOWN_MS: u64 = 750;
const COMPLETION_COOLDOWN_MS: u64 = 400;
const NAVIGATION_COOLDOWN_MS: u64 = 250;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum ForegroundIndexLane {
    VisibleFiles,
    Completion,
    Navigation,
}

#[derive(Debug, Default)]
pub(crate) struct WorkspaceIndexForegroundAdmission {
    recent: BTreeMap<(String, ForegroundIndexLane), u64>,
}

impl WorkspaceIndexForegroundAdmission {
    pub(crate) fn admit(
        &mut self,
        root_path: &str,
        priority: WorkspaceIndexTaskPriority,
        now_ms: u64,
    ) -> bool {
        let Some((lane, cooldown_ms)) = lane_for_priority(priority) else {
            return true;
        };
        let key = (root_path.to_string(), lane);
        if self
            .recent
            .get(&key)
            .is_some_and(|previous| now_ms.saturating_sub(*previous) < cooldown_ms)
        {
            return false;
        }
        self.recent.insert(key, now_ms);
        self.trim(now_ms);
        true
    }

    fn trim(&mut self, now_ms: u64) {
        self.recent.retain(|(_, lane), timestamp| {
            now_ms.saturating_sub(*timestamp) < cooldown_for_lane(*lane)
        });
        while self.recent.len() > MAX_TRACKED_ROOTS * 3 {
            let Some(key) = self.recent.keys().next().cloned() else {
                break;
            };
            self.recent.remove(&key);
        }
    }
}

fn lane_for_priority(priority: WorkspaceIndexTaskPriority) -> Option<(ForegroundIndexLane, u64)> {
    match priority {
        WorkspaceIndexTaskPriority::VisibleFiles => {
            Some((ForegroundIndexLane::VisibleFiles, VISIBLE_FILES_COOLDOWN_MS))
        }
        WorkspaceIndexTaskPriority::ForegroundCompletion => {
            Some((ForegroundIndexLane::Completion, COMPLETION_COOLDOWN_MS))
        }
        WorkspaceIndexTaskPriority::ForegroundNavigation => {
            Some((ForegroundIndexLane::Navigation, NAVIGATION_COOLDOWN_MS))
        }
        _ => None,
    }
}

fn cooldown_for_lane(lane: ForegroundIndexLane) -> u64 {
    match lane {
        ForegroundIndexLane::VisibleFiles => VISIBLE_FILES_COOLDOWN_MS,
        ForegroundIndexLane::Completion => COMPLETION_COOLDOWN_MS,
        ForegroundIndexLane::Navigation => NAVIGATION_COOLDOWN_MS,
    }
}

#[cfg(test)]
mod tests {
    use super::WorkspaceIndexForegroundAdmission;
    use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;

    #[test]
    fn keeps_visible_and_completion_hints_in_separate_lanes() {
        let mut admission = WorkspaceIndexForegroundAdmission::default();

        assert!(admission.admit(
            "/workspace",
            WorkspaceIndexTaskPriority::VisibleFiles,
            1_000
        ));
        assert!(admission.admit(
            "/workspace",
            WorkspaceIndexTaskPriority::ForegroundCompletion,
            1_001,
        ));
        assert!(!admission.admit(
            "/workspace",
            WorkspaceIndexTaskPriority::VisibleFiles,
            1_002
        ));
    }

    #[test]
    fn keeps_navigation_responsive_with_a_short_lane_budget() {
        let mut admission = WorkspaceIndexForegroundAdmission::default();

        assert!(admission.admit(
            "/workspace",
            WorkspaceIndexTaskPriority::ForegroundNavigation,
            1_000,
        ));
        assert!(!admission.admit(
            "/workspace",
            WorkspaceIndexTaskPriority::ForegroundNavigation,
            1_249,
        ));
        assert!(admission.admit(
            "/workspace",
            WorkspaceIndexTaskPriority::ForegroundNavigation,
            1_250,
        ));
    }
}
