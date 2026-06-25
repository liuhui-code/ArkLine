use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::models::language::{
    CodeAction, CodeActionResolution, CodeActionResolveRequest, LanguageQueryRequest,
};
use crate::models::workspace_edit::{
    ApplyWorkspaceEditRequest, ApplyWorkspaceEditResult, WorkspaceEditPreview,
    WorkspaceEditPreviewRequest,
};
use crate::services::language_service::{
    list_code_actions as list_code_actions_impl, resolve_code_action as resolve_code_action_impl,
    LanguageRuntime,
};
use crate::services::settings_store::load_settings_for_app;
use crate::services::workspace_edit_service::{
    apply_workspace_edit as apply_workspace_edit_impl,
    preview_workspace_edit as preview_workspace_edit_impl,
};

#[tauri::command]
pub fn list_code_actions(
    app: AppHandle,
    runtime: State<LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<CodeAction>, String> {
    let settings = load_settings_for_app(&app)?;
    Ok(list_code_actions_impl(runtime.inner(), &settings, &request))
}

#[tauri::command]
pub fn resolve_code_action(
    app: AppHandle,
    runtime: State<LanguageRuntime>,
    request: CodeActionResolveRequest,
) -> Result<CodeActionResolution, String> {
    let settings = load_settings_for_app(&app)?;
    Ok(resolve_code_action_impl(
        runtime.inner(),
        &settings,
        &request,
    ))
}

#[tauri::command]
pub fn preview_workspace_edit(
    request: WorkspaceEditPreviewRequest,
) -> Result<WorkspaceEditPreview, String> {
    preview_workspace_edit_impl(&PathBuf::from(request.workspace_root), &request.plan)
}

#[tauri::command]
pub fn apply_workspace_edit(
    request: ApplyWorkspaceEditRequest,
) -> Result<ApplyWorkspaceEditResult, String> {
    apply_workspace_edit_impl(&PathBuf::from(request.workspace_root), &request.plan)
}

#[cfg(test)]
mod tests {
    use crate::models::language::{
        CodeActionResolution, CodeActionResolveRequest, UnsupportedCodeActionResolution,
    };

    #[test]
    fn code_actions_can_return_structured_unsupported_resolution() {
        let request = CodeActionResolveRequest {
            id: "workspace.renameFile".to_string(),
            data: None,
        };
        let resolution = CodeActionResolution::Unsupported(UnsupportedCodeActionResolution {
            status: "unsupported".to_string(),
            reason: format!(
                "Resolving code action '{}' is not implemented yet.",
                request.id
            ),
        });
        let json = serde_json::to_value(resolution).unwrap();

        assert_eq!(json["status"], "unsupported");
        assert!(json["reason"]
            .as_str()
            .unwrap()
            .contains("workspace.renameFile"));
    }
}
