use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Child, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::services::process_command_service::hidden_command;

const MIN_TIMEOUT_MS: u64 = 500;
const MAX_TIMEOUT_MS: u64 = 600_000;
const STDERR_LIMIT: usize = 64 * 1024;

#[derive(Debug)]
pub struct GitQueryOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub stdout_total_bytes: usize,
    pub stdout_truncated: bool,
}

#[derive(Clone, Default)]
pub struct GitQueryRuntime {
    jobs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl GitQueryRuntime {
    pub fn run(
        &self,
        request_id: &str,
        root: &Path,
        args: &[&str],
        timeout_ms: u64,
        stdout_limit: usize,
    ) -> Result<GitQueryOutput, String> {
        validate_request_id(request_id)?;
        let cancelled = self.register(request_id)?;
        let result = run_git_process(
            root,
            args,
            Duration::from_millis(timeout_ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)),
            stdout_limit.max(1),
            &cancelled,
        );
        self.finish(request_id, &cancelled);
        result
    }

    pub fn cancel(&self, request_id: &str) -> Result<bool, String> {
        validate_request_id(request_id)?;
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| "Git query cancellation lock is unavailable".to_string())?;
        Ok(jobs.get(request_id).is_some_and(|job| {
            job.store(true, Ordering::Release);
            true
        }))
    }

    fn register(&self, request_id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| "Git query runtime lock is unavailable".to_string())?;
        let token = Arc::new(AtomicBool::new(false));
        if let Some(previous) = jobs.insert(request_id.to_string(), token.clone()) {
            previous.store(true, Ordering::Release);
        }
        Ok(token)
    }

    fn finish(&self, request_id: &str, token: &Arc<AtomicBool>) {
        if let Ok(mut jobs) = self.jobs.lock() {
            if jobs
                .get(request_id)
                .is_some_and(|current| Arc::ptr_eq(current, token))
            {
                jobs.remove(request_id);
            }
        }
    }
}

fn run_git_process(
    root: &Path,
    args: &[&str],
    timeout: Duration,
    stdout_limit: usize,
    cancelled: &AtomicBool,
) -> Result<GitQueryOutput, String> {
    let mut child = hidden_command("git")
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(map_spawn_error)?;
    let stdout_reader = spawn_bounded_reader(child.stdout.take(), stdout_limit);
    let stderr_reader = spawn_bounded_reader(child.stderr.take(), STDERR_LIMIT);
    let status = wait_for_process(&mut child, timeout, cancelled)?;
    let stdout = stdout_reader
        .join()
        .map_err(|_| "Git stdout reader stopped unexpectedly".to_string())?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "Git stderr reader stopped unexpectedly".to_string())?;
    Ok(GitQueryOutput {
        status,
        stdout: stdout.bytes,
        stderr: stderr.bytes,
        stdout_total_bytes: stdout.total_bytes,
        stdout_truncated: stdout.truncated,
    })
}

fn wait_for_process(
    child: &mut Child,
    timeout: Duration,
    cancelled: &AtomicBool,
) -> Result<ExitStatus, String> {
    let started = Instant::now();
    loop {
        if cancelled.load(Ordering::Acquire) {
            stop_process(child);
            return Err("Git query cancelled".to_string());
        }
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Ok(status);
        }
        if started.elapsed() >= timeout {
            stop_process(child);
            return Err(format!(
                "Git query timed out after {} ms",
                timeout.as_millis()
            ));
        }
        thread::sleep(Duration::from_millis(20));
    }
}

fn stop_process(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

struct BoundedRead {
    bytes: Vec<u8>,
    total_bytes: usize,
    truncated: bool,
}

fn spawn_bounded_reader<R: Read + Send + 'static>(
    reader: Option<R>,
    limit: usize,
) -> thread::JoinHandle<BoundedRead> {
    thread::spawn(move || read_bounded(reader, limit))
}

fn read_bounded<R: Read>(reader: Option<R>, limit: usize) -> BoundedRead {
    let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
    let mut total_bytes = 0;
    let mut buffer = [0_u8; 16 * 1024];
    if let Some(mut reader) = reader {
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 {
                break;
            }
            total_bytes += count;
            let retained = limit.saturating_sub(bytes.len()).min(count);
            bytes.extend_from_slice(&buffer[..retained]);
        }
    }
    BoundedRead {
        truncated: total_bytes > bytes.len(),
        bytes,
        total_bytes,
    }
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty() || request_id.len() > 160 || request_id.contains(['\n', '\0']) {
        Err("Git query request identifier is invalid".to_string())
    } else {
        Ok(())
    }
}

fn map_spawn_error(error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        "Git executable is unavailable".to_string()
    } else {
        error.to_string()
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;
    use std::path::Path;
    use std::thread;
    use std::time::{Duration, Instant};

    use super::{read_bounded, GitQueryRuntime};

    #[test]
    fn reader_drains_input_but_retains_only_the_budget() {
        let result = read_bounded(Some(Cursor::new(vec![7_u8; 4_096])), 128);
        assert_eq!(result.bytes.len(), 128);
        assert_eq!(result.total_bytes, 4_096);
        assert!(result.truncated);
    }

    #[test]
    fn replacing_a_request_cancels_the_previous_generation() {
        let runtime = GitQueryRuntime::default();
        let first = runtime.register("history-1").unwrap();
        let _second = runtime.register("history-1").unwrap();
        assert!(first.load(std::sync::atomic::Ordering::Acquire));
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_stops_a_running_git_process() {
        let runtime = GitQueryRuntime::default();
        let worker = runtime.clone();
        let started = Instant::now();
        let task = thread::spawn(move || {
            worker.run(
                "cancel-running-git",
                Path::new("."),
                &["-c", "alias.arkline-wait=!sleep 10", "arkline-wait"],
                10_000,
                1024,
            )
        });
        thread::sleep(Duration::from_millis(150));
        assert!(runtime.cancel("cancel-running-git").unwrap());
        let error = task.join().unwrap().unwrap_err();
        assert_eq!(error, "Git query cancelled");
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
