#![allow(dead_code)]

use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;

use crate::models::workspace::ArkTsFileStub;
use crate::services::workspace_arkts_stub_parser_service::parse_arkts_file_stub;
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_performance_config_service::EffectivePerformanceConfig;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexParseJob {
    pub root_path: String,
    pub path: String,
    pub priority: WorkspaceIndexTaskPriority,
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexParsedFile {
    pub root_path: String,
    pub path: String,
    pub generation: u64,
    pub stub: ArkTsFileStub,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexParseResult {
    pub job: WorkspaceIndexParseJob,
    pub parsed: Option<WorkspaceIndexParsedFile>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexParseBatchResult {
    pub results: Vec<WorkspaceIndexParseResult>,
    pub deferred_jobs: Vec<WorkspaceIndexParseJob>,
}

type ParseFn =
    dyn Fn(WorkspaceIndexParseJob) -> Result<WorkspaceIndexParsedFile, String> + Send + Sync;

#[derive(Clone)]
pub struct WorkspaceIndexParsePool {
    max_workers: usize,
    parser: Arc<ParseFn>,
}

impl WorkspaceIndexParsePool {
    pub fn new<F>(max_workers: usize, parser: F) -> Self
    where
        F: Fn(WorkspaceIndexParseJob) -> Result<WorkspaceIndexParsedFile, String>
            + Send
            + Sync
            + 'static,
    {
        Self {
            max_workers: max_workers.max(1),
            parser: Arc::new(parser),
        }
    }

    pub fn arkts_stub_pool(max_workers: usize) -> Self {
        Self::new(max_workers, parse_arkts_stub_job)
    }

    pub fn new_from_config<F>(config: &EffectivePerformanceConfig, parser: F) -> Self
    where
        F: Fn(WorkspaceIndexParseJob) -> Result<WorkspaceIndexParsedFile, String>
            + Send
            + Sync
            + 'static,
    {
        Self::new(config.parser_workers, parser)
    }

    pub fn arkts_stub_pool_from_config(config: &EffectivePerformanceConfig) -> Self {
        Self::new_from_config(config, parse_arkts_stub_job)
    }

    pub fn parse_batch(&self, jobs: Vec<WorkspaceIndexParseJob>) -> Vec<WorkspaceIndexParseResult> {
        self.parse_selected_jobs(jobs)
    }

    pub fn parse_batch_with_background_budget(
        &self,
        jobs: Vec<WorkspaceIndexParseJob>,
        max_background_jobs: usize,
    ) -> WorkspaceIndexParseBatchResult {
        let (selected_jobs, deferred_jobs) =
            select_jobs_with_background_budget(jobs, max_background_jobs);
        WorkspaceIndexParseBatchResult {
            results: self.parse_selected_jobs(selected_jobs),
            deferred_jobs,
        }
    }

    fn parse_selected_jobs(
        &self,
        jobs: Vec<WorkspaceIndexParseJob>,
    ) -> Vec<WorkspaceIndexParseResult> {
        if jobs.is_empty() {
            return Vec::new();
        }
        let worker_count = self.max_workers.min(jobs.len());
        let queue = Arc::new(Mutex::new(prioritized_queue(jobs)));
        let (result_tx, result_rx) = mpsc::channel();
        let mut workers = Vec::new();

        for _ in 0..worker_count {
            let worker_queue = queue.clone();
            let worker_tx = result_tx.clone();
            let parser = self.parser.clone();
            workers.push(thread::spawn(move || loop {
                let Some(job) = next_job(&worker_queue) else {
                    break;
                };
                let result = parse_job(&parser, job);
                if worker_tx.send(result).is_err() {
                    break;
                }
            }));
        }
        drop(result_tx);

        let mut results = result_rx.into_iter().collect::<Vec<_>>();
        for worker in workers {
            let _ = worker.join();
        }
        results.sort_by(|left, right| {
            right
                .job
                .priority
                .cmp(&left.job.priority)
                .then_with(|| left.job.generation.cmp(&right.job.generation))
                .then_with(|| left.job.path.cmp(&right.job.path))
        });
        results
    }
}

fn select_jobs_with_background_budget(
    jobs: Vec<WorkspaceIndexParseJob>,
    max_background_jobs: usize,
) -> (Vec<WorkspaceIndexParseJob>, Vec<WorkspaceIndexParseJob>) {
    let mut selected = Vec::new();
    let mut deferred = Vec::new();
    let mut background_count = 0;

    for job in prioritized_queue(jobs) {
        if is_foreground_priority(job.priority) || background_count < max_background_jobs {
            if !is_foreground_priority(job.priority) {
                background_count += 1;
            }
            selected.push(job);
        } else {
            deferred.push(job);
        }
    }

    (selected, deferred)
}

fn is_foreground_priority(priority: WorkspaceIndexTaskPriority) -> bool {
    priority >= WorkspaceIndexTaskPriority::ForegroundCompletion
}

fn prioritized_queue(mut jobs: Vec<WorkspaceIndexParseJob>) -> VecDeque<WorkspaceIndexParseJob> {
    jobs.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| left.generation.cmp(&right.generation))
            .then_with(|| left.path.cmp(&right.path))
    });
    jobs.into_iter().collect()
}

fn next_job(
    queue: &Arc<Mutex<VecDeque<WorkspaceIndexParseJob>>>,
) -> Option<WorkspaceIndexParseJob> {
    queue.lock().ok()?.pop_front()
}

fn parse_job(parser: &Arc<ParseFn>, job: WorkspaceIndexParseJob) -> WorkspaceIndexParseResult {
    match parser(job.clone()) {
        Ok(parsed) => WorkspaceIndexParseResult {
            job,
            parsed: Some(parsed),
            error: None,
        },
        Err(error) => WorkspaceIndexParseResult {
            job,
            parsed: None,
            error: Some(error),
        },
    }
}

fn parse_arkts_stub_job(job: WorkspaceIndexParseJob) -> Result<WorkspaceIndexParsedFile, String> {
    let content =
        fs::read_to_string(filesystem_path(&job.path)).map_err(|error| error.to_string())?;
    let stub = parse_arkts_file_stub(&job.path, &content);
    Ok(WorkspaceIndexParsedFile {
        root_path: job.root_path,
        path: job.path,
        generation: job.generation,
        stub,
    })
}

fn filesystem_path(path: &str) -> String {
    if Path::new(path).exists() {
        return path.to_string();
    }
    path.replace('\\', "/")
}
