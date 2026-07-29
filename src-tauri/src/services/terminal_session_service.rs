use std::env;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use crate::models::terminal::{TerminalProfileRequest, TerminalProfileResolution};

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
    let Some(cwd) = requested_cwd
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return default_terminal_cwd();
    };
    let path = Path::new(cwd);

    if path.exists() && path.is_dir() {
        cwd.to_string()
    } else if let Some(parent) = path
        .parent()
        .filter(|parent| parent.exists() && parent.is_dir())
    {
        parent.to_string_lossy().to_string()
    } else {
        default_terminal_cwd()
    }
}

pub fn default_shell() -> String {
    if cfg!(windows) {
        "cmd".to_string()
    } else {
        env::var("SHELL")
            .ok()
            .filter(|shell| !shell.trim().is_empty())
            .unwrap_or_else(|| "sh".to_string())
    }
}

pub fn resolve_terminal_profile(
    request: Option<&TerminalProfileRequest>,
) -> TerminalProfileResolution {
    let profile = request
        .map(|value| value.profile.as_str())
        .unwrap_or("system");
    let args = if profile == "custom" {
        request
            .map(|value| parse_shell_args(&value.custom_args))
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let resolved = match profile {
        "system" => Ok(default_shell()),
        "gitBash" => resolve_git_bash(),
        "powerShell" => resolve_power_shell(),
        "commandPrompt" => resolve_command_prompt(),
        "custom" => request
            .map(|value| value.custom_executable_path.trim())
            .filter(|value| !value.is_empty())
            .and_then(resolve_custom_executable)
            .ok_or_else(|| "Custom terminal executable was not found".to_string()),
        _ => Err(format!("Unknown terminal profile: {profile}")),
    };

    match resolved {
        Ok(executable) => TerminalProfileResolution {
            profile: profile.to_string(),
            available: true,
            executable: Some(executable),
            args,
            detail: "Terminal profile is ready for new sessions".to_string(),
        },
        Err(detail) => TerminalProfileResolution {
            profile: profile.to_string(),
            available: false,
            executable: None,
            args,
            detail,
        },
    }
}

fn resolve_shell_launch(
    request: Option<&TerminalProfileRequest>,
) -> Result<(String, Vec<String>), String> {
    let resolution = resolve_terminal_profile(request);
    if !resolution.available {
        return Err(resolution.detail);
    }
    Ok((
        resolution.executable.expect("available shell executable"),
        resolution.args,
    ))
}

fn resolve_git_bash() -> Result<String, String> {
    if !cfg!(windows) {
        return Err("Git Bash profile is only available on Windows".to_string());
    }
    let mut candidates = Vec::new();
    for variable in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = env::var_os(variable) {
            let root = PathBuf::from(root).join("Git");
            candidates.push(root.join("bin").join("bash.exe"));
            candidates.push(root.join("usr").join("bin").join("bash.exe"));
        }
    }
    find_on_path(&["bash.exe", "bash"])
        .or_else(|| candidates.into_iter().find(|path| path.is_file()))
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| {
            "Git Bash was not found. Install Git for Windows or choose another profile.".to_string()
        })
}

fn resolve_power_shell() -> Result<String, String> {
    find_on_path(if cfg!(windows) {
        &["pwsh.exe", "powershell.exe", "pwsh", "powershell"]
    } else {
        &["pwsh", "powershell"]
    })
    .map(|path| path.to_string_lossy().to_string())
    .ok_or_else(|| "PowerShell was not found on PATH".to_string())
}

fn resolve_command_prompt() -> Result<String, String> {
    if cfg!(windows) {
        Ok("cmd.exe".to_string())
    } else {
        Err("Command Prompt is only available on Windows".to_string())
    }
}

fn resolve_custom_executable(value: &str) -> Option<String> {
    let path = PathBuf::from(value);
    if path.is_file() {
        return Some(path.to_string_lossy().to_string());
    }
    if value.contains('/') || value.contains('\\') {
        return None;
    }
    find_on_path(&[value]).map(|path| path.to_string_lossy().to_string())
}

fn find_on_path(names: &[&str]) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .flat_map(|root| names.iter().map(move |name| root.join(name)))
        .find(|candidate| candidate.is_file())
}

fn parse_shell_args(value: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escaped = false;

    for character in value.chars() {
        if escaped {
            current.push(character);
            escaped = false;
        } else if character == '\\' && !cfg!(windows) {
            escaped = true;
        } else if Some(character) == quote {
            quote = None;
        } else if quote.is_none() && (character == '\'' || character == '"') {
            quote = Some(character);
        } else if quote.is_none() && character.is_whitespace() {
            if !current.is_empty() {
                args.push(std::mem::take(&mut current));
            }
        } else {
            current.push(character);
        }
    }
    if escaped {
        current.push('\\');
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

#[cfg(test)]
mod tests {
    use super::{parse_shell_args, resolve_terminal_profile};
    use crate::models::terminal::TerminalProfileRequest;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn parses_quoted_custom_arguments() {
        assert_eq!(
            parse_shell_args("--login \"workspace root\""),
            ["--login", "workspace root"]
        );
    }

    #[test]
    fn rejects_missing_custom_executable() {
        let result = resolve_terminal_profile(Some(&TerminalProfileRequest {
            profile: "custom".to_string(),
            custom_executable_path: "/tmp/arkline-shell-does-not-exist".to_string(),
            custom_args: String::new(),
        }));

        assert!(!result.available);
        assert!(result.detail.contains("not found"));
    }

    #[test]
    fn accepts_existing_custom_executable_and_arguments() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("arkline-shell-{suffix}"));
        fs::write(&path, b"shell").unwrap();
        let result = resolve_terminal_profile(Some(&TerminalProfileRequest {
            profile: "custom".to_string(),
            custom_executable_path: path.to_string_lossy().to_string(),
            custom_args: "--login \"project root\"".to_string(),
        }));

        assert!(result.available);
        assert_eq!(result.args, ["--login", "project root"]);
        fs::remove_file(path).unwrap();
    }
}

pub fn spawn_terminal_session(
    requested_cwd: Option<&str>,
    profile: Option<&TerminalProfileRequest>,
) -> Result<
    (
        Box<dyn MasterPty + Send>,
        Box<dyn Write + Send>,
        Box<dyn Child + Send + Sync>,
        String,
        String,
    ),
    String,
> {
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
    let (shell, args) = resolve_shell_launch(profile)?;
    let mut command = CommandBuilder::new(&shell);
    for arg in args {
        command.arg(arg);
    }
    command.cwd(PathBuf::from(&cwd));
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;

    Ok((pair.master, writer, child, shell.clone(), cwd))
}
