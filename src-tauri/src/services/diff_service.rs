use std::path::Path;

use crate::services::process_command_service::hidden_command;

pub fn load_workspace_diff_text(root_path: &Path) -> Result<String, String> {
    let output = hidden_command("git")
        .arg("-C")
        .arg(root_path)
        .arg("diff")
        .arg("--no-ext-diff")
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Ok(String::new());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
