use tauri::State;

use crate::models::terminal::{TerminalRunRequest, TerminalRunResult};
use crate::services::terminal_service::{run_command, stop_command, TerminalRuntime};

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
