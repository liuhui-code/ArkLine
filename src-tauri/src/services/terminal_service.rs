use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::models::terminal::{TerminalRunRequest, TerminalRunResult};

#[derive(Default)]
pub struct TerminalRuntime {
    children: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    stopped_runs: Mutex<HashSet<String>>,
}

impl TerminalRuntime {
    fn register_child(&self, run_id: &str, child: Arc<Mutex<Child>>) {
        self.children.lock().expect("terminal runtime child lock").insert(run_id.to_string(), child);
    }

    fn remove_child(&self, run_id: &str) {
        self.children.lock().expect("terminal runtime child lock").remove(run_id);
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

pub fn run_command(runtime: &TerminalRuntime, request: &TerminalRunRequest) -> Result<TerminalRunResult, String> {
    let mut command = shell_command(&request.command);
    if let Some(cwd) = request.cwd.as_deref().filter(|value| !value.trim().is_empty()) {
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
        stdout: stdout_reader.join().map_err(|_| "stdout reader thread panicked".to_string())?,
        stderr: stderr_reader.join().map_err(|_| "stderr reader thread panicked".to_string())?,
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
        let mut process = Command::new("cmd");
        process.arg("/C").arg(command);
        return process;
    }

    let mut process = Command::new("sh");
    process.arg("-lc").arg(command);
    process
}

fn take_streams(child: &Arc<Mutex<Child>>) -> Result<(std::process::ChildStdout, std::process::ChildStderr), String> {
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
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    use super::{run_command, stop_command, TerminalRuntime};
    use crate::models::terminal::TerminalRunRequest;

    fn request(run_id: &str, command: &str) -> TerminalRunRequest {
        TerminalRunRequest {
            run_id: run_id.to_string(),
            command: command.to_string(),
            cwd: None,
            source: "manual".to_string(),
        }
    }

    fn long_running_command() -> &'static str {
        if cfg!(windows) {
            "ping 127.0.0.1 -n 6 > nul"
        } else {
            "sleep 5"
        }
    }

    #[test]
    fn runs_a_command_and_captures_output() {
        let runtime = TerminalRuntime::default();
        let result = run_command(&runtime, &request("run-1", "echo hello")).unwrap();

        assert_eq!(result.run_id, "run-1");
        assert!(result.stdout.contains("hello"));
        assert_eq!(result.exit_code, Some(0));
        assert!(!result.stopped);
    }

    #[test]
    fn stops_a_running_command() {
        let runtime = Arc::new(TerminalRuntime::default());
        let request = request("run-2", long_running_command());
        let worker_runtime = runtime.clone();

        let handle = thread::spawn(move || run_command(&worker_runtime, &request).unwrap());

        thread::sleep(Duration::from_millis(150));
        stop_command(&runtime, "run-2").unwrap();
        let result = handle.join().unwrap();

        assert_eq!(result.run_id, "run-2");
        assert!(result.stopped);
    }
}
