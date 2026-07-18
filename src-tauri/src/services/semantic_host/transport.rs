use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::services::process_command_service::hidden_command;

use super::process::SemanticWorkerProcessSpec;

pub trait SemanticWorkerTransport: Send {
    fn process_id(&self) -> u32;
    fn write_line(&mut self, line: &str) -> Result<(), String>;
    fn recv_line(&mut self, timeout: Duration) -> Result<String, String>;
    fn terminate(&mut self);
}

pub struct DirectSemanticWorkerTransport {
    child: Child,
    stdin: ChildStdin,
    response_rx: Receiver<Result<String, String>>,
}

impl DirectSemanticWorkerTransport {
    pub fn start(spec: &SemanticWorkerProcessSpec) -> Result<Self, String> {
        let command_path = spec.node_path.as_ref().unwrap_or(&spec.entry_path);
        let mut command = hidden_command(command_path);
        if !spec.standalone {
            command.arg(&spec.entry_path);
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                format!(
                    "Failed to launch semantic worker command {} and entry {}: {error}",
                    command_path.display(),
                    spec.entry_path.display()
                )
            })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Semantic worker stdin is unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Semantic worker stdout is unavailable".to_string())?;

        Ok(Self {
            child,
            stdin,
            response_rx: spawn_stdout_reader(stdout),
        })
    }
}

impl SemanticWorkerTransport for DirectSemanticWorkerTransport {
    fn process_id(&self) -> u32 {
        self.child.id()
    }

    fn write_line(&mut self, line: &str) -> Result<(), String> {
        self.stdin
            .write_all(line.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("Failed to write semantic worker request: {error}"))
    }

    fn recv_line(&mut self, timeout: Duration) -> Result<String, String> {
        recv_response(&self.response_rx, timeout)
    }

    fn terminate(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct TauriSidecarTransport {
    child: Option<CommandChild>,
    response_rx: Receiver<Result<String, String>>,
}

impl TauriSidecarTransport {
    pub fn start(app: &tauri::AppHandle, sidecar_name: &str) -> Result<Self, String> {
        let command = app
            .shell()
            .sidecar(sidecar_name)
            .map_err(|error| format!("Failed to resolve semantic sidecar: {error}"))?;
        let (events, child) = command
            .spawn()
            .map_err(|error| format!("Failed to launch semantic sidecar: {error}"))?;
        let (response_tx, response_rx) = mpsc::channel();
        tauri::async_runtime::spawn(forward_sidecar_events(events, response_tx));

        Ok(Self {
            child: Some(child),
            response_rx,
        })
    }
}

impl SemanticWorkerTransport for TauriSidecarTransport {
    fn process_id(&self) -> u32 {
        self.child.as_ref().map(CommandChild::pid).unwrap_or(0)
    }

    fn write_line(&mut self, line: &str) -> Result<(), String> {
        let child = self
            .child
            .as_mut()
            .ok_or_else(|| "Semantic sidecar is not running".to_string())?;
        child
            .write(format!("{line}\n").as_bytes())
            .map_err(|error| format!("Failed to write semantic sidecar request: {error}"))
    }

    fn recv_line(&mut self, timeout: Duration) -> Result<String, String> {
        recv_response(&self.response_rx, timeout)
    }

    fn terminate(&mut self) {
        if let Some(child) = self.child.take() {
            let _ = child.kill();
        }
    }
}

async fn forward_sidecar_events(
    mut events: tauri::async_runtime::Receiver<CommandEvent>,
    response_tx: mpsc::Sender<Result<String, String>>,
) {
    let mut stderr_tail = String::new();
    while let Some(event) = events.recv().await {
        let result = match event {
            CommandEvent::Stdout(bytes) => Some(
                String::from_utf8(bytes)
                    .map_err(|error| format!("Semantic sidecar emitted invalid UTF-8: {error}")),
            ),
            CommandEvent::Stderr(bytes) => {
                append_stderr_tail(&mut stderr_tail, &String::from_utf8_lossy(&bytes));
                None
            }
            CommandEvent::Error(error) => Some(Err(error)),
            CommandEvent::Terminated(status) => Some(Err(format!(
                "Semantic sidecar terminated with code {:?}{}",
                status.code,
                if stderr_tail.is_empty() {
                    String::new()
                } else {
                    format!(": {stderr_tail}")
                }
            ))),
            _ => None,
        };
        if let Some(result) = result {
            if response_tx.send(result).is_err() {
                break;
            }
        }
    }
}

fn append_stderr_tail(target: &mut String, value: &str) {
    target.push_str(value);
    const MAX_STDERR_BYTES: usize = 4 * 1024;
    if target.len() > MAX_STDERR_BYTES {
        let mut start = target.len() - MAX_STDERR_BYTES;
        while !target.is_char_boundary(start) {
            start += 1;
        }
        *target = target[start..].to_string();
    }
}

fn recv_response(
    receiver: &Receiver<Result<String, String>>,
    timeout: Duration,
) -> Result<String, String> {
    match receiver.recv_timeout(timeout) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err("Timed out waiting for semantic worker response".to_string())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("Semantic worker response channel closed".to_string())
        }
    }
}

fn spawn_stdout_reader(stdout: ChildStdout) -> Receiver<Result<String, String>> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut stdout = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match stdout.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) if tx.send(Ok(line)).is_err() => break,
                Ok(_) => {}
                Err(error) => {
                    let _ = tx.send(Err(error.to_string()));
                    break;
                }
            }
        }
    });
    rx
}
