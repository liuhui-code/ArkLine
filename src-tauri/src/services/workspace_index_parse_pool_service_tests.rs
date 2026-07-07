use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::models::workspace::ArkTsFileStub;
use crate::services::workspace_index_parse_pool_service::{
    WorkspaceIndexParseJob, WorkspaceIndexParsePool, WorkspaceIndexParsedFile,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_performance_config_service::{
    resolve_performance_config, PerformanceProfile, PerformanceUserSettings,
};

#[test]
fn parse_pool_runs_jobs_concurrently() {
    let active = Arc::new(AtomicUsize::new(0));
    let max_active = Arc::new(AtomicUsize::new(0));
    let parser_active = active.clone();
    let parser_max = max_active.clone();
    let pool = WorkspaceIndexParsePool::new(2, move |job| {
        let active_now = parser_active.fetch_add(1, Ordering::SeqCst) + 1;
        update_max(&parser_max, active_now);
        thread::sleep(Duration::from_millis(40));
        parser_active.fetch_sub(1, Ordering::SeqCst);
        Ok(parsed(job))
    });

    let results = pool.parse_batch(vec![
        job("a.ets", WorkspaceIndexTaskPriority::FullRefresh, 1),
        job("b.ets", WorkspaceIndexTaskPriority::FullRefresh, 1),
    ]);

    assert_eq!(results.len(), 2);
    assert!(max_active.load(Ordering::SeqCst) >= 2);
    assert!(results.iter().all(|result| result.parsed.is_some()));
}

#[test]
fn parse_pool_runs_foreground_job_before_background_job() {
    let order = Arc::new(Mutex::new(Vec::new()));
    let parser_order = order.clone();
    let pool = WorkspaceIndexParsePool::new(1, move |job| {
        parser_order
            .lock()
            .expect("order lock")
            .push(job.path.clone());
        Ok(parsed(job))
    });

    pool.parse_batch(vec![
        job("background.ets", WorkspaceIndexTaskPriority::FullRefresh, 1),
        job(
            "foreground.ets",
            WorkspaceIndexTaskPriority::ForegroundNavigation,
            2,
        ),
    ]);

    assert_eq!(
        order.lock().expect("order lock").as_slice(),
        ["foreground.ets", "background.ets"]
    );
}

#[test]
fn parse_pool_keeps_successful_results_when_one_job_fails() {
    let pool = WorkspaceIndexParsePool::new(2, move |job| {
        if job.path == "bad.ets" {
            return Err("parse exploded".to_string());
        }
        Ok(parsed(job))
    });

    let results = pool.parse_batch(vec![
        job("good.ets", WorkspaceIndexTaskPriority::ChangedFiles, 1),
        job("bad.ets", WorkspaceIndexTaskPriority::ChangedFiles, 1),
    ]);

    assert_eq!(results.len(), 2);
    assert!(results.iter().any(|result| result.parsed.is_some()));
    assert!(results
        .iter()
        .any(|result| result.error.as_deref() == Some("parse exploded")));
}

#[test]
fn arkts_stub_pool_parses_real_source_file() {
    let root = unique_temp_dir("workspace-index-parse-pool");
    fs::create_dir_all(&root).unwrap();
    let source_path = root.join("Entry.ets");
    fs::write(
        &source_path,
        "export struct EntryBackupAbility {\n  width(): void {}\n}\n",
    )
    .unwrap();
    let source = source_path.to_string_lossy().to_string();
    let pool = WorkspaceIndexParsePool::arkts_stub_pool(1);

    let results = pool.parse_batch(vec![job(
        &source,
        WorkspaceIndexTaskPriority::ForegroundNavigation,
        1,
    )]);

    let parsed = results[0].parsed.as_ref().expect("parsed file");
    assert!(parsed
        .stub
        .declarations
        .iter()
        .any(|declaration| declaration.name == "EntryBackupAbility"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn arkts_stub_pool_uses_effective_config_worker_budget() {
    let active = Arc::new(AtomicUsize::new(0));
    let max_active = Arc::new(AtomicUsize::new(0));
    let parser_active = active.clone();
    let parser_max = max_active.clone();
    let config = resolve_performance_config(&PerformanceUserSettings {
        profile: Some(PerformanceProfile::LargeProject),
        cpu_count: Some(8),
        ..PerformanceUserSettings::default()
    });
    let pool = WorkspaceIndexParsePool::new_from_config(&config, move |job| {
        let active_now = parser_active.fetch_add(1, Ordering::SeqCst) + 1;
        update_max(&parser_max, active_now);
        thread::sleep(Duration::from_millis(20));
        parser_active.fetch_sub(1, Ordering::SeqCst);
        Ok(parsed(job))
    });

    let results = pool.parse_batch(
        (0..6)
            .map(|index| {
                job(
                    &format!("file-{index}.ets"),
                    WorkspaceIndexTaskPriority::FullRefresh,
                    1,
                )
            })
            .collect(),
    );

    assert_eq!(results.len(), 6);
    assert_eq!(max_active.load(Ordering::SeqCst), 6);
}

#[test]
fn parse_pool_budget_defers_background_jobs_over_limit() {
    let pool = WorkspaceIndexParsePool::new(2, |job| Ok(parsed(job)));
    let batch = pool.parse_batch_with_background_budget(
        (0..5)
            .map(|index| {
                job(
                    &format!("background-{index}.ets"),
                    WorkspaceIndexTaskPriority::FullRefresh,
                    1,
                )
            })
            .collect(),
        2,
    );

    assert_eq!(batch.results.len(), 2);
    assert_eq!(batch.deferred_jobs.len(), 3);
    assert!(batch
        .deferred_jobs
        .iter()
        .all(|job| job.priority == WorkspaceIndexTaskPriority::FullRefresh));
}

#[test]
fn parse_pool_budget_keeps_foreground_jobs_when_background_is_over_limit() {
    let order = Arc::new(Mutex::new(Vec::new()));
    let parser_order = order.clone();
    let pool = WorkspaceIndexParsePool::new(1, move |job| {
        parser_order
            .lock()
            .expect("order lock")
            .push(job.path.clone());
        Ok(parsed(job))
    });
    let mut jobs = (0..4)
        .map(|index| {
            job(
                &format!("background-{index}.ets"),
                WorkspaceIndexTaskPriority::FullRefresh,
                1,
            )
        })
        .collect::<Vec<_>>();
    jobs.push(job(
        "foreground.ets",
        WorkspaceIndexTaskPriority::ForegroundNavigation,
        2,
    ));

    let batch = pool.parse_batch_with_background_budget(jobs, 1);

    assert_eq!(batch.results.len(), 2);
    assert_eq!(batch.deferred_jobs.len(), 3);
    assert_eq!(
        order.lock().expect("order lock").as_slice(),
        ["foreground.ets", "background-0.ets"]
    );
}

fn job(
    path: &str,
    priority: WorkspaceIndexTaskPriority,
    generation: u64,
) -> WorkspaceIndexParseJob {
    WorkspaceIndexParseJob {
        root_path: "/workspace".to_string(),
        path: path.to_string(),
        priority,
        generation,
    }
}

fn parsed(job: WorkspaceIndexParseJob) -> WorkspaceIndexParsedFile {
    WorkspaceIndexParsedFile {
        root_path: job.root_path,
        path: job.path,
        generation: job.generation,
        stub: ArkTsFileStub {
            path: String::new(),
            module_name: None,
            imports: Vec::new(),
            exports: Vec::new(),
            declarations: Vec::new(),
            parse_errors: Vec::new(),
        },
    }
}

fn update_max(max_active: &AtomicUsize, active_now: usize) {
    let mut observed = max_active.load(Ordering::SeqCst);
    while active_now > observed {
        match max_active.compare_exchange(observed, active_now, Ordering::SeqCst, Ordering::SeqCst)
        {
            Ok(_) => break,
            Err(next) => observed = next,
        }
    }
}

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}
