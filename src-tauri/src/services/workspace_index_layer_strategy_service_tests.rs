use crate::services::workspace_index_layer_strategy_service::{
    channel_for_layer, priority_for_layer, WorkspaceIndexChannel, WorkspaceIndexLayerKind,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;

#[test]
fn maps_hot_file_and_project_layers_to_project_channel() {
    assert_eq!(
        channel_for_layer(WorkspaceIndexLayerKind::FileHot),
        WorkspaceIndexChannel::Project
    );
    assert_eq!(
        channel_for_layer(WorkspaceIndexLayerKind::ProjectFile),
        WorkspaceIndexChannel::Project
    );
    assert_eq!(
        channel_for_layer(WorkspaceIndexLayerKind::ProjectDeep),
        WorkspaceIndexChannel::Project
    );
}

#[test]
fn maps_sdk_api_layer_to_sdk_channel() {
    assert_eq!(
        channel_for_layer(WorkspaceIndexLayerKind::SdkApi),
        WorkspaceIndexChannel::SdkApi
    );
}

#[test]
fn keeps_sdk_api_below_visible_files_and_above_background_deep_work() {
    assert!(
        priority_for_layer(WorkspaceIndexLayerKind::VisibleFiles)
            > priority_for_layer(WorkspaceIndexLayerKind::SdkApi)
    );
    assert!(
        priority_for_layer(WorkspaceIndexLayerKind::SdkApi)
            > WorkspaceIndexTaskPriority::Background
    );
}
