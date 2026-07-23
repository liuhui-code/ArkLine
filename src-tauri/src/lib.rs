mod commands {
    pub mod build_configurations;
    pub mod build_project;
    pub mod code_actions;
    pub mod device_log;
    pub mod documents;
    pub mod environment;
    pub mod git_trace;
    pub mod language;
    pub mod settings;
    pub mod terminal;
    pub mod windowing;
    pub mod workspace;
    pub mod workspace_definition;
    pub(crate) mod workspace_emit;
    pub mod workspace_index;
    pub mod workspace_index_schedule;
    pub mod workspace_query;
    #[cfg(test)]
    mod workspace_tests;
}

mod models {
    pub mod build_project;
    pub mod device_log;
    pub mod device_log_query;
    pub mod diagnostics;
    pub mod language;
    pub mod terminal;
    pub mod workspace;
    pub mod workspace_edit;
    pub mod workspace_index_diagnostics;
    #[cfg(test)]
    mod workspace_index_diagnostics_tests;
    pub mod workspace_index_layer;
    pub mod workspace_index_publication;
    pub mod workspace_semantic_layer;
}

mod platform;

pub mod indexer_host;
pub mod indexer_sidecar;
mod services;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let search_sessions =
        services::workspace_search_session_service::WorkspaceSearchSessionRuntime::default();
    let query_broker = services::workspace_query_broker_service::WorkspaceQueryBrokerRuntime::new(
        search_sessions.clone(),
    );
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            platform::apply_app_icon();
            if let Ok(resource_dir) = app.path().resource_dir() {
                services::semantic_host::process::register_resource_dir(resource_dir);
            }
            let launcher = Arc::new(
                services::semantic_host::launcher::TauriSemanticWorkerLauncher::new(
                    app.handle().clone(),
                ),
            );
            app.manage(services::language_service::LanguageRuntime::new(launcher));
            Ok(())
        })
        .manage(commands::windowing::LaunchWorkspaceState::for_process())
        .manage(services::terminal_service::TerminalRuntime::default())
        .manage(services::device_log_service::DeviceLogRuntime::default())
        .manage(services::workspace_index_service::WorkspaceIndexRuntime::default())
        .manage(services::workspace_index_manager_service::WorkspaceIndexManagerRuntime::default())
        .manage(services::workspace_index_watcher_service::WorkspaceIndexWatcherRuntime::default())
        .manage(services::workspace_index_ui_activity_service::WorkspaceIndexUiActivityRuntime::default())
        .manage(services::workspace_text_search_cancellation_service::WorkspaceTextSearchCancellationRuntime::default())
        .manage(query_broker)
        .invoke_handler(tauri::generate_handler![
            commands::build_project::inspect_harmony_build_project_command,
            commands::workspace::open_workspace,
            commands::workspace::list_workspace_directory,
            commands::workspace::get_workspace_index_state,
            commands::workspace::inspect_workspace_index,
            commands::workspace::get_workspace_index_health,
            commands::workspace::get_workspace_index_task_statuses,
            commands::workspace::clear_workspace_index,
            commands::workspace::rebuild_workspace_index,
            commands::workspace::resume_workspace_indexing,
            commands::workspace::rebuild_workspace_sdk_index,
            commands::workspace::inspect_workspace_parser_failures,
            commands::workspace::inspect_workspace_unresolved_imports,
            commands::workspace::index_workspace_sdk_symbols,
            commands::workspace::submit_workspace_sdk_index,
            commands::workspace_query::query_workspace_quick_open,
            commands::workspace_query::query_workspace_search_everywhere,
            commands::workspace_query::query_workspace_candidates,
            commands::workspace_query::query_workspace_candidates_with_readiness,
            commands::workspace_query::query_workspace_file_symbols,
            commands::workspace_query::query_workspace_file_symbols_with_readiness,
            commands::workspace_definition::query_call_hierarchy,
            commands::workspace_definition::query_definition_candidates_with_readiness,
            commands::workspace_definition::query_rename_impact,
            commands::workspace_definition::query_type_hierarchy,
            commands::workspace_definition::query_usages_with_readiness,
            commands::workspace_definition::semantic_complete_symbol,
            commands::workspace::update_workspace_index_files,
            commands::workspace_index_schedule::schedule_foreground_completion_index,
            commands::workspace_index_schedule::schedule_foreground_navigation_index,
            commands::workspace_index_schedule::schedule_visible_files_index,
            commands::workspace::refresh_workspace_index,
            commands::workspace::refresh_workspace_index_with_changes,
            commands::workspace::cancel_workspace_search,
            commands::workspace::search_workspace_text,
            commands::workspace_index::explain_workspace_index_query,
            commands::workspace_index::get_workspace_index_file_readiness,
            commands::workspace_index::get_workspace_index_layer_readiness,
            commands::workspace::watch_workspace_index,
            commands::workspace::unwatch_workspace_index,
            commands::workspace::load_workspace_diff,
            commands::documents::open_text_document,
            commands::documents::save_text_document,
            commands::documents::validate_text_document,
            commands::environment::inspect_environment,
            commands::build_configurations::load_build_configurations,
            commands::build_configurations::save_build_configurations,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::language::inspect_language_service,
            commands::language::hover_symbol,
            commands::language::goto_definition,
            commands::language::goto_definition_candidates,
            commands::language::complete_symbol,
            commands::language::document_symbols,
            commands::language::find_usages,
            commands::code_actions::list_code_actions,
            commands::code_actions::resolve_code_action,
            commands::code_actions::preview_workspace_edit,
            commands::code_actions::apply_workspace_edit,
            commands::git_trace::get_file_blame,
            commands::git_trace::get_commit_trace,
            commands::terminal::create_terminal_session,
            commands::terminal::list_terminal_sessions,
            commands::terminal::write_terminal_input,
            commands::terminal::resize_terminal_session,
            commands::terminal::close_terminal_session,
            commands::terminal::stop_terminal_session,
            commands::terminal::run_terminal_command,
            commands::terminal::stop_terminal_command,
            commands::device_log::list_device_log_devices,
            commands::device_log::list_device_fault_logs,
            commands::device_log::start_device_log_stream,
            commands::device_log::stop_device_log_stream,
            commands::device_log::query_device_logs,
            commands::device_log::export_device_logs,
            commands::device_log::export_device_logs_to_file,
            commands::device_log::get_device_log_stats,
            commands::device_log::get_device_log_query_worker_stats,
            commands::device_log::get_device_log_query_worker_events,
            commands::device_log::get_device_log_storage_health,
            commands::device_log::clear_device_log_storage,
            commands::device_log::plan_device_log_retention,
            commands::device_log::apply_device_log_retention,
            commands::windowing::open_workspace_in_new_window,
            commands::windowing::get_launch_workspace_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running ArkLine");
}

#[cfg(test)]
mod tests {
    #[test]
    fn smoke_test_runs() {
        assert_eq!(2 + 2, 4);
    }
}
