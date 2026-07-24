use crate::models::workspace_index_publication::WorkspaceIndexPublicationProfile;

#[derive(Clone, Copy)]
pub(crate) struct MaintenanceMetricSample {
    pub(crate) duration_us: u64,
    pub(crate) optimized: bool,
    pub(crate) checkpointed: bool,
    pub(crate) incremental_vacuumed: bool,
    pub(crate) copy_swapped: bool,
    pub(crate) copy_swap_deferred: bool,
}

pub(crate) fn maintenance_metric_sample(
    profile: &WorkspaceIndexPublicationProfile,
) -> Option<MaintenanceMetricSample> {
    let maintenance = profile
        .stages
        .iter()
        .any(|stage| stage.name.starts_with("maintenance"));
    maintenance.then(|| MaintenanceMetricSample {
        duration_us: profile.total_duration_us,
        optimized: profile
            .stages
            .iter()
            .any(|stage| stage.name.contains("Optimize")),
        checkpointed: profile
            .stages
            .iter()
            .any(|stage| stage.name == "maintenanceTruncateCheckpoint"),
        incremental_vacuumed: profile
            .stages
            .iter()
            .any(|stage| stage.name == "maintenanceIncrementalVacuum"),
        copy_swapped: profile
            .stages
            .iter()
            .any(|stage| stage.name == "maintenanceCopySwapCommit"),
        copy_swap_deferred: profile
            .stages
            .iter()
            .any(|stage| stage.name.starts_with("maintenanceCopySwapDeferred")),
    })
}
