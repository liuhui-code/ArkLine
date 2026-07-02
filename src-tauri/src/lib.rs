mod commands {
    pub mod build_configurations;
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
    pub mod workspace_index;
    #[cfg(test)]
    mod workspace_tests;
}

mod models {
    pub mod device_log;
    pub mod diagnostics;
    pub mod language;
    pub mod terminal;
    pub mod workspace;
    pub mod workspace_edit;
}

mod platform;

mod services {
    pub mod build_configuration_store;
    pub mod device_log_service;
    pub mod diff_service;
    pub mod document_service;
    pub mod environment_doctor;
    pub mod git_trace_service;
    pub mod language_service;
    pub mod semantic;
    pub mod semantic_host;
    pub mod settings_store;
    pub mod terminal_io_service;
    pub mod terminal_service;
    pub mod terminal_session_service;
    pub mod validation_service;
    pub mod workspace_arkts_stub_parser_service;
    #[cfg(test)]
    mod workspace_arkts_stub_parser_service_tests;
    pub mod workspace_completion_item_service;
    pub mod workspace_completion_parser_service;
    pub mod workspace_completion_semantic_service;
    #[cfg(test)]
    mod workspace_completion_semantic_service_tests;
    pub mod workspace_content_index_service;
    #[cfg(test)]
    mod workspace_content_index_service_tests;
    pub mod workspace_content_query_service;
    #[cfg(test)]
    mod workspace_definition_member_query_tests;
    #[cfg(test)]
    mod workspace_definition_query_service_tests;
    pub mod workspace_definition_reference_service;
    pub mod workspace_dependency_graph_service;
    #[cfg(test)]
    mod workspace_dependency_graph_service_tests;
    pub mod workspace_edit_service;
    pub mod workspace_file_fingerprint_service;
    #[cfg(test)]
    mod workspace_file_fingerprint_service_tests;
    pub mod workspace_index_cancellation_service;
    #[cfg(test)]
    mod workspace_index_cancellation_service_tests;
    pub mod workspace_index_chunk_service;
    #[cfg(test)]
    mod workspace_index_chunk_service_tests;
    pub mod workspace_index_continuation_task_service;
    #[cfg(test)]
    mod workspace_index_continuation_task_service_tests;
    #[cfg(test)]
    mod workspace_index_dependency_expansion_service_tests;
    pub mod workspace_index_diagnostics_service;
    #[cfg(test)]
    mod workspace_index_diagnostics_service_tests;
    pub mod workspace_index_entity_persistence_service;
    #[cfg(test)]
    mod workspace_index_entity_persistence_service_tests;
    pub mod workspace_index_entity_query_service;
    #[cfg(test)]
    mod workspace_index_entity_query_service_tests;
    pub mod workspace_index_explain_service;
    #[cfg(test)]
    mod workspace_index_explain_service_tests;
    pub mod workspace_index_facade_service;
    #[cfg(test)]
    mod workspace_index_facade_service_tests;
    pub mod workspace_index_full_refresh_service;
    #[cfg(test)]
    mod workspace_index_full_refresh_service_tests;
    pub mod workspace_index_health_service;
    #[cfg(test)]
    mod workspace_index_health_service_tests;
    #[cfg(test)]
    mod workspace_index_lifecycle_service_tests;
    pub mod workspace_index_maintenance_service;
    #[cfg(test)]
    mod workspace_index_maintenance_service_tests;
    #[cfg(test)]
    mod workspace_index_manager_priority_tests;
    #[cfg(test)]
    mod workspace_index_manager_resume_tests;
    pub mod workspace_index_manager_service;
    #[cfg(test)]
    mod workspace_index_manager_service_tests;
    pub mod workspace_index_persistence_service;
    #[cfg(test)]
    mod workspace_index_query_scope_service_tests;
    pub mod workspace_index_query_service;
    #[cfg(test)]
    mod workspace_index_query_service_tests;
    pub mod workspace_index_readiness_service;
    #[cfg(test)]
    mod workspace_index_readiness_service_tests;
    pub mod workspace_index_repair_service;
    #[cfg(test)]
    mod workspace_index_repair_service_tests;
    pub mod workspace_index_resume_service;
    #[cfg(test)]
    mod workspace_index_resume_service_tests;
    #[cfg(test)]
    mod workspace_index_running_lifecycle_service_tests;
    pub mod workspace_index_scheduler_service;
    pub mod workspace_index_schema_service;
    #[cfg(test)]
    mod workspace_index_schema_service_tests;
    pub mod workspace_index_service;
    #[cfg(test)]
    mod workspace_index_service_tests;
    pub mod workspace_index_state_machine_service;
    #[cfg(test)]
    mod workspace_index_state_machine_service_tests;
    pub mod workspace_index_task_journal_service;
    #[cfg(test)]
    mod workspace_index_task_journal_service_tests;
    pub mod workspace_index_task_lifecycle_service;
    pub mod workspace_index_task_status_service;
    #[cfg(test)]
    mod workspace_index_test_fixture_service;
    pub mod workspace_index_text_candidate_service;
    pub mod workspace_index_watcher_service;
    pub mod workspace_index_worker_service;
    #[cfg(test)]
    mod workspace_index_worker_service_tests;
    #[cfg(test)]
    pub mod workspace_large_fixture_service;
    #[cfg(test)]
    mod workspace_large_project_index_tests;
    #[cfg(test)]
    mod workspace_reference_branch_flow_tests;
    #[cfg(test)]
    mod workspace_reference_chain_receiver_tests;
    pub mod workspace_reference_declaration_index_service;
    #[cfg(test)]
    mod workspace_reference_deep_generic_tests;
    pub mod workspace_reference_generic_receiver_service;
    pub mod workspace_reference_identifier_index_service;
    pub mod workspace_reference_index_service;
    #[cfg(test)]
    mod workspace_reference_index_service_tests;
    pub mod workspace_reference_member_access_parser_service;
    pub mod workspace_reference_member_index_service;
    #[cfg(test)]
    mod workspace_reference_receiver_tests;
    pub mod workspace_reference_receiver_type_service;
    pub mod workspace_sdk_index_service;
    #[cfg(test)]
    mod workspace_sdk_index_service_tests;
    pub mod workspace_sdk_parser_service;
    #[cfg(test)]
    mod workspace_sdk_persistence_service_tests;
    pub mod workspace_sdk_schema_service;
    #[cfg(test)]
    mod workspace_search_everywhere_service_tests;
    pub mod workspace_search_ranking_service;
    #[cfg(test)]
    mod workspace_search_ranking_service_tests;
    pub mod workspace_service;
    pub mod workspace_stub_index_service;
    #[cfg(test)]
    mod workspace_stub_index_service_tests;
    pub mod workspace_symbol_identity_service;
    pub mod workspace_symbol_index_service;
    pub mod workspace_symbol_resolution_alias_service;
    pub mod workspace_symbol_resolution_query_service;
    #[cfg(test)]
    mod workspace_symbol_resolution_query_service_tests;
    pub mod workspace_symbol_resolution_schema_service;
    pub mod workspace_symbol_resolution_service;
    #[cfg(test)]
    mod workspace_symbol_resolution_service_tests;
    pub mod workspace_text_search_service;
    #[cfg(test)]
    mod workspace_usage_confidence_tests;
    pub mod workspace_usage_query_service;
    #[cfg(test)]
    mod workspace_usage_query_service_tests;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_| {
            platform::apply_app_icon();
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .manage(services::language_service::LanguageRuntime::default())
        .manage(commands::windowing::LaunchWorkspaceState::default())
        .manage(services::terminal_service::TerminalRuntime::default())
        .manage(services::device_log_service::DeviceLogRuntime::default())
        .manage(services::workspace_index_service::WorkspaceIndexRuntime::default())
        .manage(services::workspace_index_manager_service::WorkspaceIndexManagerRuntime::default())
        .manage(services::workspace_index_watcher_service::WorkspaceIndexWatcherRuntime::default())
        .invoke_handler(tauri::generate_handler![
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
            commands::workspace::query_workspace_quick_open,
            commands::workspace::query_workspace_search_everywhere,
            commands::workspace::query_workspace_candidates,
            commands::workspace::query_workspace_candidates_with_readiness,
            commands::workspace::query_workspace_file_symbols,
            commands::workspace::query_workspace_file_symbols_with_readiness,
            commands::workspace_definition::query_definition_candidates_with_readiness,
            commands::workspace_definition::query_usages_with_readiness,
            commands::workspace_definition::semantic_complete_symbol,
            commands::workspace::update_workspace_index_files,
            commands::workspace::schedule_foreground_completion_index,
            commands::workspace::schedule_visible_files_index,
            commands::workspace::refresh_workspace_index,
            commands::workspace::refresh_workspace_index_with_changes,
            commands::workspace::search_workspace_text,
            commands::workspace_index::explain_workspace_index_query,
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
