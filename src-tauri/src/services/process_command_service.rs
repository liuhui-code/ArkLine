use std::ffi::OsStr;
use std::process::Command;

pub fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    configure_no_console_window(&mut command);
    command
}

#[cfg(windows)]
fn configure_no_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_no_console_window(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::hidden_command;

    #[test]
    fn hidden_command_preserves_normal_output_capture() {
        let output = if cfg!(windows) {
            hidden_command("cmd").args(["/C", "echo arkline"]).output()
        } else {
            hidden_command("sh").args(["-c", "printf arkline"]).output()
        }
        .unwrap();

        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("arkline"));
    }
}
