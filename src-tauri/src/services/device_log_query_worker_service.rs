use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use crate::models::device_log_query::{
    DeviceLogQueryRequest, DeviceLogQueryResponse, DeviceLogQueryStopReason,
    DeviceLogQueryWorkerEvent, DeviceLogQueryWorkerStats,
};
use crate::services::device_log_query_generation_service::{
    DeviceLogQueryGenerationRegistry, DeviceLogQueryToken,
};

type QueryExecutor = Arc<
    dyn Fn(
            &DeviceLogQueryRequest,
            &mut dyn FnMut() -> bool,
        ) -> Result<DeviceLogQueryResponse, String>
        + Send
        + Sync,
>;

const QUERY_WORKER_EVENT_LIMIT: usize = 64;

#[derive(Clone)]
pub struct DeviceLogQueryWorker {
    sender: Sender<DeviceLogQueryJob>,
    generations: Arc<DeviceLogQueryGenerationRegistry>,
    stats: Arc<Mutex<DeviceLogQueryWorkerStats>>,
    events: Arc<Mutex<VecDeque<DeviceLogQueryWorkerEvent>>>,
}

impl DeviceLogQueryWorker {
    pub fn new(executor: QueryExecutor) -> Self {
        let (sender, receiver) = mpsc::channel::<DeviceLogQueryJob>();
        let stats = Arc::new(Mutex::new(DeviceLogQueryWorkerStats::default()));
        let worker_stats = stats.clone();
        let events = Arc::new(Mutex::new(VecDeque::new()));
        let worker_events = events.clone();
        let next_event_sequence = Arc::new(AtomicU64::new(1));
        let worker_next_event_sequence = next_event_sequence.clone();
        thread::Builder::new()
            .name("arkline-device-log-query-worker".to_string())
            .spawn(move || {
                while let Ok(job) = receiver.recv() {
                    mark_job_started(&worker_stats);
                    let started = Instant::now();
                    let mut should_cancel = || job.token.cancelled();
                    let response = executor(&job.request, &mut should_cancel);
                    let query_ms = started.elapsed().as_millis() as u64;
                    record_job_finished(
                        &worker_stats,
                        &worker_events,
                        &worker_next_event_sequence,
                        &job.request,
                        &response,
                        query_ms,
                    );
                    let _ = job.reply.send(response);
                }
            })
            .expect("spawn device log query worker");
        Self {
            sender,
            generations: Arc::new(DeviceLogQueryGenerationRegistry::default()),
            stats,
            events,
        }
    }

    pub fn submit_latest(
        &self,
        request: DeviceLogQueryRequest,
    ) -> Result<DeviceLogQueryResponse, String> {
        let token = self.generations.begin(&request.stream_id);
        let (reply, response) = mpsc::channel();
        self.stats
            .lock()
            .expect("device log query stats lock")
            .queued += 1;
        self.sender
            .send(DeviceLogQueryJob {
                request,
                token,
                reply,
            })
            .map_err(|_| "Device log query worker is unavailable".to_string())?;
        response
            .recv()
            .map_err(|_| "Device log query worker stopped before returning a result".to_string())?
    }

    pub fn stats(&self) -> DeviceLogQueryWorkerStats {
        self.stats
            .lock()
            .expect("device log query stats lock")
            .clone()
    }

    pub fn recent_events(&self) -> Vec<DeviceLogQueryWorkerEvent> {
        self.events
            .lock()
            .expect("device log query event lock")
            .iter()
            .cloned()
            .collect()
    }
}

struct DeviceLogQueryJob {
    request: DeviceLogQueryRequest,
    token: DeviceLogQueryToken,
    reply: Sender<Result<DeviceLogQueryResponse, String>>,
}

fn mark_job_started(stats: &Arc<Mutex<DeviceLogQueryWorkerStats>>) {
    let mut stats = stats.lock().expect("device log query stats lock");
    stats.queued = stats.queued.saturating_sub(1);
    stats.running = true;
}

fn record_job_finished(
    stats: &Arc<Mutex<DeviceLogQueryWorkerStats>>,
    events: &Arc<Mutex<VecDeque<DeviceLogQueryWorkerEvent>>>,
    next_event_sequence: &Arc<AtomicU64>,
    request: &DeviceLogQueryRequest,
    response: &Result<DeviceLogQueryResponse, String>,
    query_ms: u64,
) {
    let mut stats = stats.lock().expect("device log query stats lock");
    stats.running = false;
    stats.last_query_ms = query_ms;
    let status = match response {
        Ok(response) if response.stop_reason == DeviceLogQueryStopReason::Cancelled => "cancelled",
        Ok(_) => "completed",
        Err(_) => "failed",
    };
    match response {
        Ok(response) if response.stop_reason == DeviceLogQueryStopReason::Cancelled => {
            stats.cancelled_queries += 1;
            stats.last_error = None;
        }
        Ok(_) => {
            stats.completed_queries += 1;
            stats.last_error = None;
        }
        Err(error) => {
            stats.failed_queries += 1;
            stats.last_error = Some(error.clone());
        }
    }
    let error = response.as_ref().err().cloned();
    drop(stats);
    push_event(
        events,
        DeviceLogQueryWorkerEvent {
            sequence: next_event_sequence.fetch_add(1, Ordering::SeqCst),
            stream_id: request.stream_id.clone(),
            query: request.query.clone(),
            status: status.to_string(),
            duration_ms: query_ms,
            error,
        },
    );
}

fn push_event(
    events: &Arc<Mutex<VecDeque<DeviceLogQueryWorkerEvent>>>,
    event: DeviceLogQueryWorkerEvent,
) {
    let mut events = events.lock().expect("device log query event lock");
    events.push_back(event);
    while events.len() > QUERY_WORKER_EVENT_LIMIT {
        events.pop_front();
    }
}
