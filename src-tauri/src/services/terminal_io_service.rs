use crate::services::terminal_session_service::TerminalSessionHandle;

pub fn session_status(handle: &TerminalSessionHandle) -> String {
    handle.status()
}
