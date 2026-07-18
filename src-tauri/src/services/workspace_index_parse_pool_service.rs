#![allow(dead_code)]

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::sync::{mpsc, Arc, Condvar, Mutex, OnceLock};
use std::thread::{self, JoinHandle};

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
    owner: Arc<ParsePoolOwner>,
}

struct ParsePoolOwner {
    state: Arc<ParseWorkerState>,
    workers: Mutex<Vec<JoinHandle<()>>>,
}

struct ParseWorkerState {
    parser: Arc<ParseFn>,
    queue: Mutex<ParseQueue>,
    ready: Condvar,
}

#[derive(Default)]
struct ParseQueue {
    tasks: VecDeque<ParseTask>,
    stopping: bool,
}

struct ParseTask {
    job: WorkspaceIndexParseJob,
    result_tx: mpsc::Sender<WorkspaceIndexParseResult>,
}

type SharedStubPools = Mutex<HashMap<(usize, bool), WorkspaceIndexParsePool>>;
static SHARED_STUB_POOLS: OnceLock<SharedStubPools> = OnceLock::new();

impl WorkspaceIndexParsePool {
    pub fn new<F>(max_workers: usize, parser: F) -> Self
    where
        F: Fn(WorkspaceIndexParseJob) -> Result<WorkspaceIndexParsedFile, String>
            + Send
            + Sync
            + 'static,
    {
        Self::new_with_foreground_reserve(max_workers, false, parser)
    }

    pub fn new_with_foreground_reserve<F>(
        max_workers: usize,
        foreground_task_reserve: bool,
        parser: F,
    ) -> Self
    where
        F: Fn(WorkspaceIndexParseJob) -> Result<WorkspaceIndexParsedFile, String>
            + Send
            + Sync
            + 'static,
    {
        let worker_count = max_workers.max(1);
        let state = Arc::new(ParseWorkerState {
            parser: Arc::new(parser),
            queue: Mutex::new(ParseQueue::default()),
            ready: Condvar::new(),
        });
        let workers = start_workers(&state, worker_count, foreground_task_reserve);
        Self {
            owner: Arc::new(ParsePoolOwner {
                state,
                workers: Mutex::new(workers),
            }),
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
        Self::new_with_foreground_reserve(
            config.parser_workers,
            config.foreground_task_reserve,
            parser,
        )
    }

    pub fn arkts_stub_pool_from_config(config: &EffectivePerformanceConfig) -> Self {
        let key = (config.parser_workers.max(1), config.foreground_task_reserve);
        SHARED_STUB_POOLS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .expect("shared stub parse pool lock")
            .entry(key)
            .or_insert_with(|| {
                Self::new_with_foreground_reserve(key.0, key.1, parse_arkts_stub_job)
            })
            .clone()
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
        let (result_tx, result_rx) = mpsc::channel();
        let result_count = jobs.len();
        {
            let mut queue = self
                .owner
                .state
                .queue
                .lock()
                .expect("parse worker queue lock");
            for job in prioritized_queue(jobs) {
                queue.tasks.push_back(ParseTask {
                    job,
                    result_tx: result_tx.clone(),
                });
            }
            sort_parse_tasks(&mut queue.tasks);
        }
        drop(result_tx);
        self.owner.state.ready.notify_all();

        let mut results = (0..result_count)
            .filter_map(|_| result_rx.recv().ok())
            .collect::<Vec<_>>();
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

impl Drop for ParsePoolOwner {
    fn drop(&mut self) {
        if let Ok(mut queue) = self.state.queue.lock() {
            queue.stopping = true;
        }
        self.state.ready.notify_all();
        if let Ok(workers) = self.workers.get_mut() {
            for worker in workers.drain(..) {
                let _ = worker.join();
            }
        }
    }
}

fn start_workers(
    state: &Arc<ParseWorkerState>,
    worker_count: usize,
    foreground_task_reserve: bool,
) -> Vec<JoinHandle<()>> {
    (0..worker_count)
        .map(|worker_index| {
            let worker_state = state.clone();
            let foreground_only = foreground_task_reserve && worker_count > 1 && worker_index == 0;
            thread::Builder::new()
                .name(format!("arkline-index-parse-{worker_index}"))
                .spawn(move || run_worker(worker_state, foreground_only))
                .expect("failed to start index parse worker")
        })
        .collect()
}

fn run_worker(state: Arc<ParseWorkerState>, foreground_only: bool) {
    loop {
        let task = {
            let mut queue = match state.queue.lock() {
                Ok(queue) => queue,
                Err(_) => return,
            };
            loop {
                if queue.stopping {
                    return;
                }
                if let Some(task) = take_next_task(&mut queue.tasks, foreground_only) {
                    break task;
                }
                queue = match state.ready.wait(queue) {
                    Ok(queue) => queue,
                    Err(_) => return,
                };
            }
        };
        let job = task.job.clone();
        let result = catch_unwind(AssertUnwindSafe(|| parse_job(&state.parser, task.job)))
            .unwrap_or_else(|_| WorkspaceIndexParseResult {
                job,
                parsed: None,
                error: Some("Parser worker panicked".to_string()),
            });
        let _ = task.result_tx.send(result);
    }
}

fn take_next_task(tasks: &mut VecDeque<ParseTask>, foreground_only: bool) -> Option<ParseTask> {
    if !foreground_only {
        return tasks.pop_front();
    }
    let index = tasks
        .iter()
        .position(|task| is_foreground_priority(task.job.priority))?;
    tasks.remove(index)
}

fn sort_parse_tasks(tasks: &mut VecDeque<ParseTask>) {
    let mut sorted = tasks.drain(..).collect::<Vec<_>>();
    sorted.sort_by(|left, right| compare_jobs(&left.job, &right.job));
    tasks.extend(sorted);
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
    jobs.sort_by(compare_jobs);
    jobs.into_iter().collect()
}

fn compare_jobs(
    left: &WorkspaceIndexParseJob,
    right: &WorkspaceIndexParseJob,
) -> std::cmp::Ordering {
    right
        .priority
        .cmp(&left.priority)
        .then_with(|| left.generation.cmp(&right.generation))
        .then_with(|| left.path.cmp(&right.path))
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
