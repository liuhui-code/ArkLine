use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::json;

use super::transport::SemanticWorkerTransport;
use crate::models::language::SemanticRequestActorSnapshot;

const REQUEST_QUEUE_CAPACITY: usize = 8;
const REQUEST_QUEUE_CAPACITY_HINT: usize = REQUEST_QUEUE_CAPACITY;
const RESPONSE_DELIVERY_GRACE: Duration = Duration::from_secs(1);

pub struct SemanticRequestActor {
    sender: SyncSender<ActorCommand>,
    state: Arc<ActorState>,
    process_id: u32,
    worker: Mutex<Option<JoinHandle<()>>>,
}

struct ActorState {
    running: AtomicBool,
    queued: AtomicUsize,
    completed: AtomicU64,
    superseded: AtomicU64,
    failed: AtomicU64,
}

enum ActorCommand {
    Exchange(ExchangeRequest),
    Shutdown,
}

struct ExchangeRequest {
    request_id: String,
    method: String,
    serialized: String,
    expected_generation: Option<u64>,
    deadline: Instant,
    response: Sender<Result<String, String>>,
}

impl SemanticRequestActor {
    pub fn start(transport: Box<dyn SemanticWorkerTransport>) -> Self {
        let process_id = transport.process_id();
        let state = Arc::new(ActorState::default());
        let (sender, receiver) = mpsc::sync_channel(REQUEST_QUEUE_CAPACITY);
        let actor_state = state.clone();
        let worker = thread::spawn(move || run_actor(transport, receiver, actor_state));
        Self {
            sender,
            state,
            process_id,
            worker: Mutex::new(Some(worker)),
        }
    }

    pub fn exchange(
        &self,
        request_id: String,
        method: String,
        serialized: String,
        expected_generation: Option<u64>,
        timeout: Duration,
    ) -> Result<String, String> {
        let (response, receiver) = mpsc::channel();
        if self
            .state
            .queued
            .fetch_update(Ordering::AcqRel, Ordering::Relaxed, |queued| {
                (queued < REQUEST_QUEUE_CAPACITY).then_some(queued + 1)
            })
            .is_err()
        {
            return Err("Semantic worker request queue is full".to_string());
        }
        let command = ActorCommand::Exchange(ExchangeRequest {
            request_id,
            method,
            serialized,
            expected_generation,
            deadline: Instant::now() + timeout,
            response,
        });
        match self.sender.try_send(command) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                self.state.queued.fetch_sub(1, Ordering::Relaxed);
                return Err("Semantic worker request queue is full".to_string());
            }
            Err(TrySendError::Disconnected(_)) => {
                self.state.queued.fetch_sub(1, Ordering::Relaxed);
                return Err("Semantic worker request actor is unavailable".to_string());
            }
        }
        receiver
            .recv_timeout(timeout.saturating_add(RESPONSE_DELIVERY_GRACE))
            .map_err(|_| "Timed out waiting for semantic worker request actor".to_string())?
    }

    pub fn is_busy(&self) -> bool {
        self.state.running.load(Ordering::Relaxed) || self.state.queued.load(Ordering::Relaxed) > 0
    }

    pub fn process_id(&self) -> u32 {
        self.process_id
    }

    pub fn snapshot(&self) -> SemanticRequestActorSnapshot {
        SemanticRequestActorSnapshot {
            running: self.state.running.load(Ordering::Relaxed),
            queued: self.state.queued.load(Ordering::Relaxed),
            completed: self.state.completed.load(Ordering::Relaxed),
            superseded: self.state.superseded.load(Ordering::Relaxed),
            failed: self.state.failed.load(Ordering::Relaxed),
        }
    }
}

impl Default for ActorState {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            queued: AtomicUsize::new(0),
            completed: AtomicU64::new(0),
            superseded: AtomicU64::new(0),
            failed: AtomicU64::new(0),
        }
    }
}

impl Drop for SemanticRequestActor {
    fn drop(&mut self) {
        let _ = self.sender.send(ActorCommand::Shutdown);
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
    }
}

fn run_actor(
    mut transport: Box<dyn SemanticWorkerTransport>,
    receiver: Receiver<ActorCommand>,
    state: Arc<ActorState>,
) {
    let mut backlog = VecDeque::with_capacity(REQUEST_QUEUE_CAPACITY_HINT);
    loop {
        if backlog.is_empty() {
            match receiver.recv() {
                Ok(command) => backlog.push_back(command),
                Err(_) => break,
            }
        }
        while let Ok(command) = receiver.try_recv() {
            backlog.push_back(command);
        }
        if backlog
            .iter()
            .any(|command| matches!(command, ActorCommand::Shutdown))
        {
            supersede_queued_requests(&mut backlog, &state);
            break;
        }
        compact_replaceable_requests(&mut backlog, &state);

        match backlog.pop_front() {
            Some(ActorCommand::Exchange(request)) => execute(&mut *transport, request, &state),
            Some(ActorCommand::Shutdown) | None => break,
        }
    }
    transport.terminate();
}

fn supersede_queued_requests(backlog: &mut VecDeque<ActorCommand>, state: &ActorState) {
    for command in backlog.drain(..) {
        if let ActorCommand::Exchange(request) = command {
            state.queued.fetch_sub(1, Ordering::Relaxed);
            state.superseded.fetch_add(1, Ordering::Relaxed);
            let _ = request.response.send(Ok(superseded_response(&request)));
        }
    }
}

fn compact_replaceable_requests(backlog: &mut VecDeque<ActorCommand>, state: &ActorState) {
    let latest_by_method = ["completion", "gotoDefinition"]
        .into_iter()
        .filter_map(|method| {
            backlog
                .iter()
                .enumerate()
                .filter_map(|(index, command)| match command {
                    ActorCommand::Exchange(request) if request.method == method => Some(index),
                    _ => None,
                })
                .last()
                .map(|index| (method, index))
        })
        .collect::<std::collections::HashMap<_, _>>();
    if latest_by_method.is_empty() {
        return;
    }

    let mut retained = VecDeque::with_capacity(backlog.len());
    for (index, command) in backlog.drain(..).enumerate() {
        let replaceable = match &command {
            ActorCommand::Exchange(request) => latest_by_method
                .get(request.method.as_str())
                .is_some_and(|latest| *latest != index),
            ActorCommand::Shutdown => false,
        };
        if replaceable {
            if let ActorCommand::Exchange(request) = command {
                state.queued.fetch_sub(1, Ordering::Relaxed);
                state.superseded.fetch_add(1, Ordering::Relaxed);
                let _ = request.response.send(Ok(superseded_response(&request)));
            }
        } else {
            retained.push_back(command);
        }
    }
    *backlog = retained;
}

fn execute(
    transport: &mut dyn SemanticWorkerTransport,
    request: ExchangeRequest,
    state: &ActorState,
) {
    state.queued.fetch_sub(1, Ordering::Relaxed);
    if Instant::now() >= request.deadline {
        state.superseded.fetch_add(1, Ordering::Relaxed);
        let _ = request.response.send(Ok(superseded_response(&request)));
        return;
    }

    state.running.store(true, Ordering::Relaxed);
    let result = exchange_transport(transport, &request);
    state.running.store(false, Ordering::Relaxed);
    if result.is_ok() {
        state.completed.fetch_add(1, Ordering::Relaxed);
    } else {
        state.failed.fetch_add(1, Ordering::Relaxed);
    }
    let failed = result.is_err();
    let _ = request.response.send(result);
    if failed {
        transport.terminate();
    }
}

fn exchange_transport(
    transport: &mut dyn SemanticWorkerTransport,
    request: &ExchangeRequest,
) -> Result<String, String> {
    transport.write_line(&request.serialized).map_err(|error| {
        format!(
            "Failed to write semantic worker request {}: {error}",
            request.request_id
        )
    })?;
    let remaining = request.deadline.saturating_duration_since(Instant::now());
    match transport.recv_line(remaining) {
        Ok(line) => Ok(line),
        Err(error) => Err(format!(
            "Failed to read semantic worker response {}: {error}",
            request.request_id
        )),
    }
}

fn superseded_response(request: &ExchangeRequest) -> String {
    let payload = match request.method.as_str() {
        "completion" => json!([]),
        "gotoDefinition" => json!({ "definition": null }),
        _ => json!([]),
    };
    json!({
        "id": request.request_id,
        "ok": true,
        "payload": payload,
        "state": request.expected_generation.map(|generation| json!({
            "contentGeneration": generation,
            "syntaxReady": false
        }))
    })
    .to_string()
}
