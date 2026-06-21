use crate::services::terminal_session_service::TerminalSessionHandle;
use portable_pty::PtySize;

pub fn session_status(handle: &TerminalSessionHandle) -> String {
    handle.status()
}

pub fn write_session_input(handle: &TerminalSessionHandle, data: &str) -> Result<(), String> {
    use std::io::Write;

    let mut writer = handle.writer.lock().expect("terminal writer lock");
    writer.write_all(data.as_bytes()).map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

pub fn resize_session(handle: &TerminalSessionHandle, cols: u16, rows: u16) -> Result<(), String> {
    let master = handle.master.lock().expect("terminal master lock");
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

pub fn stop_session(handle: &TerminalSessionHandle) -> Result<(), String> {
    handle.kill()
}
