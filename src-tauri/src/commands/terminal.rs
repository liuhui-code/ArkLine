use tauri::State;

use crate::models::terminal::{
    CreateTerminalSessionRequest, TerminalInputWriteRequest, TerminalResizeRequest,
    TerminalRunRequest, TerminalRunResult, TerminalSessionSummary,
};
use crate::services::terminal_service::{
    close_session, create_session, list_sessions, run_command, stop_command, TerminalRuntime,
};

#[tauri::command]
pub fn create_terminal_session(
    runtime: State<TerminalRuntime>,
    request: CreateTerminalSessionRequest,
) -> Result<TerminalSessionSummary, String> {
    create_session(runtime.inner(), request)
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
    let _ = runtime;
    let _ = request;
    Ok(())
}

#[tauri::command]
pub fn resize_terminal_session(
    runtime: State<TerminalRuntime>,
    request: TerminalResizeRequest,
) -> Result<(), String> {
    let _ = runtime;
    let _ = request;
    Ok(())
}

#[tauri::command]
pub fn close_terminal_session(
    runtime: State<TerminalRuntime>,
    session_id: String,
) -> Result<(), String> {
    close_session(runtime.inner(), &session_id)
}

#[tauri::command]
pub fn stop_terminal_session(runtime: State<TerminalRuntime>, session_id: String) -> Result<(), String> {
    let _ = runtime;
    let _ = session_id;
    Ok(())
}

#[tauri::command]
pub fn run_terminal_command(
    runtime: State<TerminalRuntime>,
    request: TerminalRunRequest,
) -> Result<TerminalRunResult, String> {
    run_command(runtime.inner(), &request)
}

#[tauri::command]
pub fn stop_terminal_command(runtime: State<TerminalRuntime>, run_id: String) -> Result<(), String> {
    stop_command(runtime.inner(), &run_id)
}
