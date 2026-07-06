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
    use crate::models::workspace::{WorkspaceIndexState, WorkspaceIndexStatus};
    use crate::services::workspace_content_index_service::index_workspace_content;
    use crate::services::workspace_file_fingerprint_service::update_file_fingerprints;
    use crate::services::workspace_index_manager_service::WorkspaceIndexManagerRuntime;
    use crate::services::workspace_index_performance_gate_service::{
        evaluate_deep_layer_performance, samples_from_stub_profile,
        WorkspaceIndexPerfGateThresholds,
    };
    use crate::services::workspace_index_persistence_service::persist_catalog_cache;
    use crate::services::workspace_index_schema_service::migrate_workspace_index_schema;
    use crate::services::workspace_index_service::WorkspaceIndexRuntime;
    use crate::services::workspace_service::scan_workspace;
    use crate::services::workspace_stub_index_service::profile_replace_all_stub_rows;
    use crate::services::workspace_symbol_index_service::index_workspace_symbols;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{Instant, SystemTime, UNIX_EPOCH};

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

    #[test]
    #[ignore = "Run explicitly to profile large fixture index stages"]
    fn profiles_generated_large_workspace_fixture_index_stages() {
        let file_count = std::env::var("ARKLINE_LARGE_FIXTURE_FILES")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(1_000);
        let root = unique_temp_dir(&format!("large-workspace-stage-profile-{file_count}"));
        super::generate_large_workspace_fixture(&root, file_count).unwrap();
        let snapshot = scan_workspace(&root).unwrap();

        let schema_start = Instant::now();
        migrate_workspace_index_schema(&snapshot.root_path).unwrap();
        let schema_duration = schema_start.elapsed();

        let root_path = snapshot.root_path.replace('/', "\\");
        let file_paths = snapshot
            .files
            .iter()
            .map(|path| path.replace('/', "\\"))
            .collect::<Vec<_>>();
        let symbol_start = Instant::now();
        let symbols = index_workspace_symbols(&file_paths);
        let symbol_duration = symbol_start.elapsed();
        let state = WorkspaceIndexState {
            status: if snapshot.scan_summary.truncated {
                WorkspaceIndexStatus::Partial
            } else {
                WorkspaceIndexStatus::Ready
            },
            root_path: Some(root_path.clone()),
            file_paths,
            symbols,
            indexed_at: Some(1),
            partial_reason: None,
        };

        let content_start = Instant::now();
        index_workspace_content(&snapshot.root_path, &state.file_paths).unwrap();
        let content_duration = content_start.elapsed();

        let catalog_start = Instant::now();
        persist_catalog_cache(&snapshot, &state).unwrap();
        let catalog_duration = catalog_start.elapsed();
        let sqlite_path = root
            .join(".arkline")
            .join("index")
            .join("workspace-catalog.sqlite");
        let mut connection = rusqlite::Connection::open(&sqlite_path).unwrap();
        let transaction = connection.transaction().unwrap();
        let stub_profile =
            profile_replace_all_stub_rows(&transaction, &root_path, &state.file_paths, 2).unwrap();
        transaction.commit().unwrap();
        let gate_report = evaluate_deep_layer_performance(
            samples_from_stub_profile("generated", 0, state.file_paths.len(), &stub_profile),
            WorkspaceIndexPerfGateThresholds::default(),
        );

        let fingerprint_start = Instant::now();
        update_file_fingerprints(&snapshot.root_path, &state.file_paths, 1).unwrap();
        let fingerprint_duration = fingerprint_start.elapsed();

        eprintln!(
            "Large fixture stage profile: files={file_count}, schema={schema_duration:?}, symbols={symbol_duration:?}, content={content_duration:?}, catalog_stub_reference={catalog_duration:?}, stub_delete={:?}, stub_insert={:?}, graph={:?}, resolve={:?}, references={:?}, fingerprints={fingerprint_duration:?}",
            stub_profile.delete_duration,
            stub_profile.insert_duration,
            stub_profile.graph_duration,
            stub_profile.resolve_duration,
            stub_profile.reference_duration
        );
        eprintln!("Large fixture deep-layer gate report: {gate_report:#?}");
        assert_eq!(gate_report.sample_count, 6);
        assert!(gate_report.slowest_stage.is_some());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "Run explicitly for large fixture open-path performance verification"]
    fn verifies_generated_large_workspace_open_pipeline() {
        let file_count = std::env::var("ARKLINE_LARGE_FIXTURE_FILES")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(10_000);
        let root = unique_temp_dir(&format!("large-workspace-open-{file_count}"));
        super::generate_large_workspace_fixture(&root, file_count).unwrap();
        let snapshot = scan_workspace(&root).unwrap();
        let runtime = crate::services::workspace_index_service::WorkspaceIndexRuntime::default();

        let index_start = Instant::now();
        let state = runtime
            .index_workspace_snapshot_for_open(&snapshot)
            .unwrap();
        let index_duration = index_start.elapsed();
        let query_start = Instant::now();
        let quick_open_hits = runtime
            .query_quick_open(&snapshot.root_path, "file-00000", 20)
            .unwrap()
            .len();
        let query_duration = query_start.elapsed();

        eprintln!(
            "Large fixture open profile: files={file_count}, indexed={}, open_index={index_duration:?}, quick_open={query_duration:?}",
            state.file_paths.len()
        );

        assert_eq!(state.file_paths.len(), usize::min(file_count, 20_000));
        assert!(quick_open_hits > 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "Run explicitly to profile realistic open plus background refresh"]
    fn profiles_generated_large_workspace_open_background_refresh_pipeline() {
        let file_count = std::env::var("ARKLINE_LARGE_FIXTURE_FILES")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(1_000);
        let root = unique_temp_dir(&format!("large-workspace-open-refresh-{file_count}"));
        super::generate_large_workspace_fixture(&root, file_count).unwrap();
        let root_path = root.to_string_lossy().to_string();
        let runtime = WorkspaceIndexRuntime::default();
        let manager = WorkspaceIndexManagerRuntime::default();

        manager.open_workspace_index(&root_path).unwrap();
        let total_start = Instant::now();
        let first_tick_start = Instant::now();
        let first_results = manager.run_index_worker_once(&runtime, |_| {}).unwrap();
        let first_tick_duration = first_tick_start.elapsed();
        let mut tick_durations = vec![first_tick_duration];
        let mut tick_kinds = vec![first_results
            .iter()
            .map(|result| format!("{}:{}", result.kind, result.status))
            .collect::<Vec<_>>()
            .join("+")];

        let mut ticks = 1usize;
        let mut result_count = first_results.len();
        let mut partial_count = first_results
            .iter()
            .filter(|result| result.status == "partial")
            .count();
        while manager
            .get_queue_pressure(&root_path)
            .unwrap()
            .workspace_pending_task_count
            > 0
        {
            assert!(
                ticks < 512,
                "background refresh did not drain after 512 ticks"
            );
            let tick_start = Instant::now();
            let results = manager.run_index_worker_once(&runtime, |_| {}).unwrap();
            tick_durations.push(tick_start.elapsed());
            tick_kinds.push(
                results
                    .iter()
                    .map(|result| format!("{}:{}", result.kind, result.status))
                    .collect::<Vec<_>>()
                    .join("+"),
            );
            partial_count += results
                .iter()
                .filter(|result| result.status == "partial")
                .count();
            result_count += results.len();
            ticks += 1;
        }
        let total_duration = total_start.elapsed();
        let quick_open_start = Instant::now();
        let quick_open_hits = runtime
            .query_quick_open(&root_path, "file-00000", 20)
            .unwrap()
            .len();
        let quick_open_duration = quick_open_start.elapsed();

        eprintln!(
            "Large fixture open+background profile: files={file_count}, first_tick={first_tick_duration:?}, total={total_duration:?}, ticks={ticks}, results={result_count}, partials={partial_count}, quick_open={quick_open_duration:?}, tick_durations={tick_durations:?}, tick_kinds={tick_kinds:?}"
        );

        assert!(result_count >= 2);
        assert!(quick_open_hits > 0);
        fs::remove_dir_all(root).unwrap();
    }
}
