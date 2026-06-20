mod commands {
    pub mod documents;
    pub mod environment;
    pub mod language;
    pub mod settings;
    pub mod terminal;
    pub mod workspace;
}

mod models {
    pub mod diagnostics;
    pub mod language;
    pub mod terminal;
    pub mod workspace;
}

mod services {
    pub mod diff_service;
    pub mod document_service;
    pub mod environment_doctor;
    pub mod language_service;
    pub mod settings_store;
    pub mod terminal_service;
    pub mod validation_service;
    pub mod workspace_service;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(services::language_service::LanguageRuntime::default())
        .manage(services::terminal_service::TerminalRuntime::default())
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
            commands::language::complete_symbol,
            commands::terminal::run_terminal_command,
            commands::terminal::stop_terminal_command
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
