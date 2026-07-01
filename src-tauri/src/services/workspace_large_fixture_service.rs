use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_service::scan_workspace;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LargeWorkspaceFixture {
    pub root_path: String,
    pub app_path: String,
    pub service_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LargeWorkspaceFixtureReport {
    pub root_path: String,
    pub requested_files: usize,
    pub scanned_files: usize,
    pub indexed_files: usize,
    pub truncated: bool,
    pub quick_open_hits: usize,
    pub generate_duration: Duration,
    pub scan_duration: Duration,
    pub index_duration: Duration,
    pub query_duration: Duration,
}

pub fn create_large_workspace_fixture(
    name: &str,
    file_count: usize,
) -> Result<LargeWorkspaceFixture, String> {
    let root = unique_temp_dir(name);
    let source_dir = root.join("entry").join("src").join("main").join("ets");
    fs::create_dir_all(&source_dir).map_err(|error| error.to_string())?;

    let service_path = source_dir.join("LargeTargetService.ets");
    fs::write(
        &service_path,
        [
            "export class LargeTargetService {",
            "  loadLargeTarget() { return \"large\"; }",
            "}",
        ]
        .join("\n"),
    )
    .map_err(|error| error.to_string())?;

    let app_path = source_dir.join("LargeApp.ets");
    fs::write(
        &app_path,
        [
            "import { LargeTargetService } from \"./LargeTargetService\";",
            "const service = new LargeTargetService();",
            "service.loadLargeTarget();",
        ]
        .join("\n"),
    )
    .map_err(|error| error.to_string())?;

    for index in 0..file_count {
        let bucket = index / 64;
        let directory = source_dir.join("pages").join(format!("bucket-{bucket:03}"));
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        fs::write(
            directory.join(format!("FeaturePage{index:03}.ets")),
            format!(
                "@Entry\n@Component\nstruct FeaturePage{index:03} {{\n  build() {{\n    Text(\"LARGE_TEXT_MARKER_{index:03}\")\n  }}\n}}\n"
            ),
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(LargeWorkspaceFixture {
        root_path: root.to_string_lossy().to_string(),
        app_path: app_path.to_string_lossy().to_string(),
        service_path: service_path.to_string_lossy().to_string(),
    })
}

pub fn verify_large_workspace_fixture(
    root_path: &Path,
    file_count: usize,
) -> Result<LargeWorkspaceFixtureReport, String> {
    let generate_start = Instant::now();
    generate_large_workspace_fixture(root_path, file_count)?;
    let generate_duration = generate_start.elapsed();

    let scan_start = Instant::now();
    let snapshot = scan_workspace(root_path)?;
    let scan_duration = scan_start.elapsed();

    let index_runtime = WorkspaceIndexRuntime::default();
    let index_start = Instant::now();
    let state = index_runtime.index_workspace_snapshot(&snapshot)?;
    let index_duration = index_start.elapsed();

    let query_start = Instant::now();
    let query = if state
        .file_paths
        .iter()
        .any(|path| path.contains("file-00000"))
    {
        "file-00000"
    } else {
        "file"
    };
    let quick_open_hits = index_runtime
        .query_quick_open(&snapshot.root_path, query, 20)?
        .len();
    let query_duration = query_start.elapsed();

    Ok(LargeWorkspaceFixtureReport {
        root_path: snapshot.root_path,
        requested_files: file_count,
        scanned_files: snapshot.scan_summary.scanned_files,
        indexed_files: state.file_paths.len(),
        truncated: snapshot.scan_summary.truncated,
        quick_open_hits,
        generate_duration,
        scan_duration,
        index_duration,
        query_duration,
    })
}

fn unique_temp_dir(name: &str) -> std::path::PathBuf {
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

fn generate_large_workspace_fixture(root_path: &Path, file_count: usize) -> Result<(), String> {
    fs::create_dir_all(root_path).map_err(|error| error.to_string())?;

    for index in 0..file_count {
        let bucket = index / 1_000;
        let directory = root_path
            .join("entry")
            .join("src")
            .join("main")
            .join("ets")
            .join("pages")
            .join(format!("bucket-{bucket:03}"));
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        fs::write(
            directory.join(format!("file-{index:05}.ets")),
            format!(
                "@Entry\n@Component\nstruct Fixture{index} {{\n  build() {{\n    Text(\"file-{index:05}\")\n  }}\n}}\n"
            ),
        )
        .map_err(|error| error.to_string())?;
    }

    fs::create_dir_all(root_path.join("oh_modules").join("ignored"))
        .map_err(|error| error.to_string())?;
    fs::write(
        root_path
            .join("oh_modules")
            .join("ignored")
            .join("index.js"),
        "",
    )
    .map_err(|error| error.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::verify_large_workspace_fixture;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
    }

    #[test]
    fn verifies_lightweight_large_workspace_fixture_pipeline() {
        let root = unique_temp_dir("large-workspace-fixture-light");

        let report = verify_large_workspace_fixture(&root, 128).unwrap();

        assert_eq!(report.requested_files, 128);
        assert_eq!(report.scanned_files, 128);
        assert_eq!(report.indexed_files, 128);
        assert!(!report.truncated);
        assert!(report.quick_open_hits > 0);
        assert!(root
            .join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite")
            .exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "Run explicitly for large fixture performance verification"]
    fn verifies_generated_large_workspace_fixture_pipeline() {
        let file_count = std::env::var("ARKLINE_LARGE_FIXTURE_FILES")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(10_000);
        let root = unique_temp_dir(&format!("large-workspace-fixture-{file_count}"));

        let report = verify_large_workspace_fixture(&root, file_count).unwrap();
        eprintln!("{report:#?}");

        assert_eq!(report.requested_files, file_count);
        assert_eq!(report.scanned_files, usize::min(file_count, 20_000));
        assert_eq!(report.indexed_files, usize::min(file_count, 20_000));
        assert_eq!(report.truncated, file_count > 20_000);
        assert!(report.quick_open_hits > 0);

        fs::remove_dir_all(root).unwrap();
    }
}
