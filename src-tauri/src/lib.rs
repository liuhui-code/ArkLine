mod commands {
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
    pub mod diff_service;
    pub mod document_service;
    pub mod environment_doctor;
    pub mod git_trace_service;
    pub mod language_service;
    pub mod semantic;
    pub mod semantic_host;
    pub mod settings_store;
    pub mod terminal_io_service;
    pub mod terminal_session_service;
    pub mod terminal_service;
    pub mod device_log_service;
    pub mod validation_service;
    pub mod workspace_edit_service;
    pub mod workspace_service;
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
        .invoke_handler(tauri::generate_handler![
            commands::workspace::open_workspace,
            commands::workspace::load_workspace_diff,
            commands::documents::open_text_document,
            commands::documents::save_text_document,
            commands::documents::validate_text_document,
            commands::environment::inspect_environment,
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
