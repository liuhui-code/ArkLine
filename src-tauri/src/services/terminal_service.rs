use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::models::terminal::{
    CreateTerminalSessionRequest, TerminalInputWriteRequest, TerminalOutputChunk,
    TerminalResizeRequest, TerminalRunRequest, TerminalRunResult, TerminalSessionSummary,
};
use crate::services::process_command_service::hidden_command;
use crate::services::terminal_io_service::{
    resize_session, session_status, stop_session, write_session_input,
};
use crate::services::terminal_session_service::{spawn_terminal_session, TerminalSessionHandle};
use tauri::{AppHandle, Emitter};

pub struct TerminalRuntime {
    children: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    stopped_runs: Mutex<HashSet<String>>,
    sessions: Mutex<HashMap<String, Arc<TerminalSessionHandle>>>,
    next_id: AtomicU64,
}

impl Default for TerminalRuntime {
    fn default() -> Self {
        Self {
            children: Mutex::new(HashMap::new()),
            stopped_runs: Mutex::new(HashSet::new()),
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(0),
        }
    }
}

impl TerminalRuntime {
    fn register_child(&self, run_id: &str, child: Arc<Mutex<Child>>) {
        self.children
            .lock()
            .expect("terminal runtime child lock")
            .insert(run_id.to_string(), child);
    }

    fn remove_child(&self, run_id: &str) {
        self.children
            .lock()
            .expect("terminal runtime child lock")
            .remove(run_id);
    }

    fn mark_stopped(&self, run_id: &str) {
        self.stopped_runs
            .lock()
            .expect("terminal runtime stopped lock")
            .insert(run_id.to_string());
    }

    fn take_stopped(&self, run_id: &str) -> bool {
        self.stopped_runs
            .lock()
            .expect("terminal runtime stopped lock")
            .remove(run_id)
    }
}

pub fn create_session(
    runtime: &TerminalRuntime,
    request: CreateTerminalSessionRequest,
) -> Result<TerminalSessionSummary, String> {
    let session_number = runtime.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let session_id = format!("session-{session_number}");
    let (master, writer, child, shell, cwd) = spawn_terminal_session(request.cwd.as_deref())?;
    let title = shell.clone();
    let handle = Arc::new(TerminalSessionHandle::new(
        title.clone(),
        cwd.clone(),
        shell.clone(),
        master,
        writer,
        child,
    ));

    runtime
        .sessions
        .lock()
        .expect("terminal session lock")
        .insert(session_id.clone(), handle);

    Ok(TerminalSessionSummary {
        id: session_id,
        title,
        cwd,
        shell,
        status: "idle".to_string(),
    })
}

pub fn list_sessions(runtime: &TerminalRuntime) -> Vec<TerminalSessionSummary> {
    let sessions = runtime.sessions.lock().expect("terminal session lock");
    let mut summaries = sessions
        .iter()
        .map(|(id, handle)| TerminalSessionSummary {
            id: id.clone(),
            title: handle.title.clone(),
            cwd: handle.cwd.clone(),
            shell: handle.shell.clone(),
            status: session_status(handle),
        })
        .collect::<Vec<_>>();
    summaries.sort_by(|left, right| left.id.cmp(&right.id));
    summaries
}

pub fn close_session(runtime: &TerminalRuntime, session_id: &str) -> Result<(), String> {
    let handle = runtime
        .sessions
        .lock()
        .expect("terminal session lock")
        .remove(session_id);

    if let Some(handle) = handle {
        handle.kill()?;
    }

    Ok(())
}

pub fn start_output_forwarder(
    app_handle: AppHandle,
    runtime: &TerminalRuntime,
    session_id: &str,
) -> Result<(), String> {
    let handle = runtime
        .sessions
        .lock()
        .expect("terminal session lock")
        .get(session_id)
        .cloned()
        .ok_or_else(|| format!("Unknown terminal session: {session_id}"))?;
    let mut reader = handle
        .master
        .lock()
        .expect("terminal master lock")
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let session_id = session_id.to_string();

    thread::spawn(move || {
        let mut buffer = [0u8; 4096];

        loop {
            let size = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => size,
                Err(_) => break,
            };

            let data = String::from_utf8_lossy(&buffer[..size]).to_string();
            let _ = app_handle.emit(
                "terminal-output",
                TerminalOutputChunk {
                    session_id: session_id.clone(),
                    data,
                },
            );
        }
    });

    Ok(())
}

pub fn write_input(
    runtime: &TerminalRuntime,
    request: &TerminalInputWriteRequest,
) -> Result<(), String> {
    let sessions = runtime.sessions.lock().expect("terminal session lock");
    let handle = sessions
        .get(&request.session_id)
        .ok_or_else(|| format!("Unknown terminal session: {}", request.session_id))?;

    write_session_input(handle, &request.data)
}

pub fn resize_active_session(
    runtime: &TerminalRuntime,
    request: &TerminalResizeRequest,
) -> Result<(), String> {
    let sessions = runtime.sessions.lock().expect("terminal session lock");
    let handle = sessions
        .get(&request.session_id)
        .ok_or_else(|| format!("Unknown terminal session: {}", request.session_id))?;

    resize_session(handle, request.cols, request.rows)
}

pub fn stop_active_session(runtime: &TerminalRuntime, session_id: &str) -> Result<(), String> {
    let sessions = runtime.sessions.lock().expect("terminal session lock");
    let handle = sessions
        .get(session_id)
        .ok_or_else(|| format!("Unknown terminal session: {session_id}"))?;

    stop_session(handle)
}

pub fn run_command(
    runtime: &TerminalRuntime,
    request: &TerminalRunRequest,
) -> Result<TerminalRunResult, String> {
    let mut command = shell_command(&request.command);
    if let Some(cwd) = request
        .cwd
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        command.current_dir(Path::new(cwd));
    }

    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let child = command.spawn().map_err(|error| error.to_string())?;
    let child = Arc::new(Mutex::new(child));
    runtime.register_child(&request.run_id, child.clone());

    let (stdout, stderr) = take_streams(&child)?;
    let stdout_reader = spawn_reader(stdout);
    let stderr_reader = spawn_reader(stderr);
    let started_at = Instant::now();

    let exit_code = loop {
        let status = {
            let mut child = child.lock().expect("terminal child lock");
            child.try_wait().map_err(|error| error.to_string())?
        };

        if let Some(status) = status {
            break status.code();
        }

        thread::sleep(Duration::from_millis(25));
    };

    runtime.remove_child(&request.run_id);
    let stopped = runtime.take_stopped(&request.run_id) || exit_code.is_none();

    Ok(TerminalRunResult {
        run_id: request.run_id.clone(),
        command: request.command.clone(),
        stdout: stdout_reader
            .join()
            .map_err(|_| "stdout reader thread panicked".to_string())?,
        stderr: stderr_reader
            .join()
            .map_err(|_| "stderr reader thread panicked".to_string())?,
        exit_code,
        duration_ms: started_at.elapsed().as_millis() as u64,
        stopped,
    })
}

pub fn stop_command(runtime: &TerminalRuntime, run_id: &str) -> Result<(), String> {
    let child = runtime
        .children
        .lock()
        .expect("terminal runtime child lock")
        .get(run_id)
        .cloned();

    let Some(child) = child else {
        return Ok(());
    };

    runtime.mark_stopped(run_id);
    let result = child
        .lock()
        .expect("terminal child lock")
        .kill()
        .map_err(|error| error.to_string());
    result
}

fn shell_command(command: &str) -> Command {
    if cfg!(windows) {
        let mut process = hidden_command("cmd");
        process.arg("/C").arg(command);
        return process;
    }

    let mut process = hidden_command("sh");
    process.arg("-lc").arg(command);
    process
}

fn take_streams(
    child: &Arc<Mutex<Child>>,
) -> Result<(std::process::ChildStdout, std::process::ChildStderr), String> {
    let mut child = child.lock().expect("terminal child lock");
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "terminal stdout pipe was not available".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "terminal stderr pipe was not available".to_string())?;

    Ok((stdout, stderr))
}

fn spawn_reader<R>(mut stream: R) -> thread::JoinHandle<String>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffer = String::new();
        let _ = stream.read_to_string(&mut buffer);
        buffer
    })
}

#[cfg(test)]
mod tests {
    use super::{close_session, create_session, list_sessions, TerminalRuntime};
    use crate::models::terminal::CreateTerminalSessionRequest;

    #[test]
    fn creates_lists_and_closes_terminal_sessions() {
        let runtime = TerminalRuntime::default();
        let session = create_session(&runtime, CreateTerminalSessionRequest { cwd: None }).unwrap();

        assert_eq!(list_sessions(&runtime).len(), 1);
        assert_eq!(session.status, "idle");

        close_session(&runtime, &session.id).unwrap();
        assert!(list_sessions(&runtime).is_empty());
    }
}
