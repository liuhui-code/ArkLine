#![allow(dead_code)]

use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceIndexLayerKind {
    FileHot,
    VisibleFiles,
    ProjectFile,
    ProjectDeep,
    SdkApi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceIndexChannel {
    Project,
    SdkApi,
}

pub fn channel_for_layer(layer: WorkspaceIndexLayerKind) -> WorkspaceIndexChannel {
    match layer {
        WorkspaceIndexLayerKind::SdkApi => WorkspaceIndexChannel::SdkApi,
        WorkspaceIndexLayerKind::FileHot
        | WorkspaceIndexLayerKind::VisibleFiles
        | WorkspaceIndexLayerKind::ProjectFile
        | WorkspaceIndexLayerKind::ProjectDeep => WorkspaceIndexChannel::Project,
    }
}

pub fn priority_for_layer(layer: WorkspaceIndexLayerKind) -> WorkspaceIndexTaskPriority {
    match layer {
        WorkspaceIndexLayerKind::FileHot => WorkspaceIndexTaskPriority::ForegroundNavigation,
        WorkspaceIndexLayerKind::VisibleFiles => WorkspaceIndexTaskPriority::VisibleFiles,
        WorkspaceIndexLayerKind::ProjectFile => WorkspaceIndexTaskPriority::FullRefresh,
        WorkspaceIndexLayerKind::SdkApi => WorkspaceIndexTaskPriority::SdkIndexing,
        WorkspaceIndexLayerKind::ProjectDeep => WorkspaceIndexTaskPriority::Background,
    }
}
