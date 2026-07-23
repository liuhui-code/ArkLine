use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexPublicationArtifactDescriptor {
    pub path: String,
    pub byte_count: u64,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexPublicationProfile {
    #[serde(default)]
    pub root_path: String,
    pub total_duration_us: u64,
    pub stages: Vec<WorkspaceIndexPublicationStage>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexPublicationStage {
    pub name: String,
    pub duration_us: u64,
}

pub(crate) struct WorkspaceIndexPublicationProfiler {
    started: Instant,
    stages: Vec<WorkspaceIndexPublicationStage>,
}

impl WorkspaceIndexPublicationProfiler {
    pub(crate) fn start() -> Self {
        Self {
            started: Instant::now(),
            stages: Vec::new(),
        }
    }

    pub(crate) fn measure<T>(
        &mut self,
        name: &str,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let started = Instant::now();
        let result = operation();
        self.stages.push(WorkspaceIndexPublicationStage {
            name: name.to_string(),
            duration_us: duration_us(started.elapsed()),
        });
        result
    }

    pub(crate) fn record(&mut self, name: &str, duration: Duration) {
        self.stages.push(WorkspaceIndexPublicationStage {
            name: name.to_string(),
            duration_us: duration_us(duration),
        });
    }

    pub(crate) fn finish(self) -> WorkspaceIndexPublicationProfile {
        WorkspaceIndexPublicationProfile {
            root_path: String::new(),
            total_duration_us: duration_us(self.started.elapsed()),
            stages: self.stages,
        }
    }
}

fn duration_us(duration: Duration) -> u64 {
    u64::try_from(duration.as_micros()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::WorkspaceIndexPublicationProfiler;

    #[test]
    fn profiler_keeps_named_stage_evidence() {
        let mut profiler = WorkspaceIndexPublicationProfiler::start();
        profiler.measure("publish", || Ok::<_, String>(())).unwrap();
        let profile = profiler.finish();

        assert_eq!(profile.stages.len(), 1);
        assert_eq!(profile.stages[0].name, "publish");
        assert!(profile.total_duration_us >= profile.stages[0].duration_us);
    }
}
