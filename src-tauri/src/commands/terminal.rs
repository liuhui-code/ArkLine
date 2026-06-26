use tauri::{AppHandle, State};

use crate::models::terminal::{
    CreateTerminalSessionRequest, TerminalInputWriteRequest, TerminalResizeRequest,
    TerminalRunRequest, TerminalRunResult, TerminalSessionSummary,
};
use crate::services::terminal_service::{
    close_session, create_session, list_sessions, resize_active_session, run_command,
    start_output_forwarder, stop_active_session, stop_command, write_input, TerminalRuntime,
};

#[tauri::command]
pub fn create_terminal_session(
    app: AppHandle,
    runtime: State<TerminalRuntime>,
    request: CreateTerminalSessionRequest,
) -> Result<TerminalSessionSummary, String> {
    let session = create_session(runtime.inner(), request)?;
    start_output_forwarder(app, runtime.inner(), &session.id)?;
    Ok(session)
}

#[tauri::command]
pub fn list_terminal_sessions(
    runtime: State<TerminalRuntime>,
) -> Result<Vec<TerminalSessionSummary>, String> {
    Ok(list_sessions(runtime.inner()))
}

#[tauri::command]
pub fn write_terminal_input(
    runtime: State<TerminalRuntime>,
    request: TerminalInputWriteRequest,
) -> Result<(), String> {
    write_input(runtime.inner(), &request)
}

#[tauri::command]
pub fn resize_terminal_session(
    runtime: State<TerminalRuntime>,
    request: TerminalResizeRequest,
) -> Result<(), String> {
    resize_active_session(runtime.inner(), &request)
}

#[tauri::command]
pub fn close_terminal_session(
    runtime: State<TerminalRuntime>,
    session_id: String,
) -> Result<(), String> {
    close_session(runtime.inner(), &session_id)
}

#[tauri::command]
pub fn stop_terminal_session(
    runtime: State<TerminalRuntime>,
    session_id: String,
) -> Result<(), String> {
    stop_active_session(runtime.inner(), &session_id)
}

#[tauri::command]
pub fn run_terminal_command(
    runtime: State<TerminalRuntime>,
    request: TerminalRunRequest,
) -> Result<TerminalRunResult, String> {
    run_command(runtime.inner(), &request)
}

#[tauri::command]
pub fn stop_terminal_command(
    runtime: State<TerminalRuntime>,
    run_id: String,
) -> Result<(), String> {
    stop_command(runtime.inner(), &run_id)
}
