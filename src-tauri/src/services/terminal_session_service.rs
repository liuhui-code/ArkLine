use std::env;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

pub struct TerminalSessionHandle {
    pub title: String,
    pub cwd: String,
    pub shell: String,
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub writer: Mutex<Box<dyn Write + Send>>,
    pub child: Mutex<Box<dyn Child + Send + Sync>>,
}

impl TerminalSessionHandle {
    pub fn new(
        title: String,
        cwd: String,
        shell: String,
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn Write + Send>,
        child: Box<dyn Child + Send + Sync>,
    ) -> Self {
        Self {
            title,
            cwd,
            shell,
            master: Mutex::new(master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
        }
    }

    pub fn status(&self) -> String {
        match self.child.lock().expect("terminal child lock").try_wait() {
            Ok(Some(_)) => "closed".to_string(),
            Ok(None) => "idle".to_string(),
            Err(_) => "error".to_string(),
        }
    }

    pub fn kill(&self) -> Result<(), String> {
        let mut child = self.child.lock().expect("terminal child lock");

        match child.try_wait() {
            Ok(Some(_)) => Ok(()),
            Ok(None) => child.kill().map_err(|error| error.to_string()),
            Err(error) => Err(error.to_string()),
        }
    }
}

pub fn default_terminal_cwd() -> String {
    env::current_dir()
        .unwrap_or_else(|_| env::temp_dir())
        .to_string_lossy()
        .to_string()
}

pub fn resolve_terminal_cwd(requested_cwd: Option<&str>) -> String {
    let Some(cwd) = requested_cwd.map(str::trim).filter(|value| !value.is_empty()) else {
        return default_terminal_cwd();
    };
    let path = Path::new(cwd);

    if path.exists() && path.is_dir() {
        cwd.to_string()
    } else if let Some(parent) = path.parent().filter(|parent| parent.exists() && parent.is_dir()) {
        parent.to_string_lossy().to_string()
    } else {
        default_terminal_cwd()
    }
}

pub fn default_shell() -> String {
    if cfg!(windows) {
        "cmd".to_string()
    } else {
        env::var("SHELL").unwrap_or_else(|_| "sh".to_string())
    }
}

pub fn spawn_terminal_session(
    requested_cwd: Option<&str>,
) -> Result<(Box<dyn MasterPty + Send>, Box<dyn Write + Send>, Box<dyn Child + Send + Sync>, String, String), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;
    let cwd = resolve_terminal_cwd(requested_cwd);
    let shell = default_shell();
    let mut command = CommandBuilder::new(&shell);
    command.cwd(PathBuf::from(&cwd));
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    let writer = pair.master.take_writer().map_err(|error| error.to_string())?;

    Ok((pair.master, writer, child, shell.clone(), cwd))
}
