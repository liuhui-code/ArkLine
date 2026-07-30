use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::Value;

use super::request_actor::SemanticRequestActor;
use super::transport::SemanticWorkerTransport;

struct SlowTransport {
    current_id: String,
    writes: Arc<Mutex<Vec<String>>>,
    first_started: Sender<()>,
    first_release: Receiver<()>,
}

struct SlowTerminateTransport;

impl SemanticWorkerTransport for SlowTerminateTransport {
    fn process_id(&self) -> u32 {
        78
    }

    fn write_line(&mut self, _line: &str) -> Result<(), String> {
        Ok(())
    }

    fn recv_line(&mut self, timeout: Duration) -> Result<String, String> {
        thread::sleep(timeout.saturating_add(Duration::from_millis(100)));
        Err("Timed out waiting for semantic worker response".to_string())
    }

    fn terminate(&mut self) {
        thread::sleep(Duration::from_millis(100));
    }
}

impl SemanticWorkerTransport for SlowTransport {
    fn process_id(&self) -> u32 {
        77
    }

    fn write_line(&mut self, line: &str) -> Result<(), String> {
        let request: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
        self.current_id = request["id"].as_str().unwrap_or_default().to_string();
        self.writes.lock().unwrap().push(self.current_id.clone());
        if self.current_id.ends_with("-1") {
            let _ = self.first_started.send(());
        }
        Ok(())
    }

    fn recv_line(&mut self, _timeout: Duration) -> Result<String, String> {
        if self.current_id.ends_with("-1") {
            self.first_release
                .recv_timeout(Duration::from_secs(1))
                .unwrap();
        }
        Ok(serde_json::json!({
            "id": self.current_id,
            "ok": true,
            "payload": { "executed": true }
        })
        .to_string())
    }

    fn terminate(&mut self) {}
}

#[test]
fn completion_actor_keeps_only_the_latest_queued_completion() {
    let writes = Arc::new(Mutex::new(Vec::new()));
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let actor = Arc::new(SemanticRequestActor::start(Box::new(SlowTransport {
        current_id: String::new(),
        writes: writes.clone(),
        first_started: started_tx,
        first_release: release_rx,
    })));

    let first = spawn_exchange(actor.clone(), "completion-1");
    started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
    let second = spawn_exchange(actor.clone(), "completion-2");
    wait_for_queued(&actor, 1);
    let third = spawn_exchange(actor.clone(), "completion-3");
    wait_for_queued(&actor, 2);
    assert_eq!(actor.snapshot().queued, 2);
    release_tx.send(()).unwrap();

    let first_response = first.join().unwrap();
    let second_response = second.join().unwrap();
    let third_response = third.join().unwrap();

    assert_eq!(first_response["payload"]["executed"], true);
    assert_eq!(second_response["payload"], serde_json::json!([]));
    assert_eq!(third_response["payload"]["executed"], true);
    assert_eq!(*writes.lock().unwrap(), ["completion-1", "completion-3"]);
    assert_eq!(actor.snapshot().completed, 2);
    assert_eq!(actor.snapshot().superseded, 1);
}

#[test]
fn definition_actor_keeps_only_the_latest_queued_definition() {
    let writes = Arc::new(Mutex::new(Vec::new()));
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let actor = Arc::new(SemanticRequestActor::start(Box::new(SlowTransport {
        current_id: String::new(),
        writes: writes.clone(),
        first_started: started_tx,
        first_release: release_rx,
    })));

    let first = spawn_exchange_with_method(actor.clone(), "gotoDefinition", "goto-1");
    started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
    let second = spawn_exchange_with_method(actor.clone(), "gotoDefinition", "goto-2");
    wait_for_queued(&actor, 1);
    let third = spawn_exchange_with_method(actor.clone(), "gotoDefinition", "goto-3");
    wait_for_queued(&actor, 2);
    release_tx.send(()).unwrap();

    let first_response = first.join().unwrap();
    let second_response = second.join().unwrap();
    let third_response = third.join().unwrap();

    assert_eq!(first_response["payload"]["executed"], true);
    assert_eq!(second_response["payload"]["definition"], Value::Null);
    assert_eq!(third_response["payload"]["executed"], true);
    assert_eq!(*writes.lock().unwrap(), ["goto-1", "goto-3"]);
    assert_eq!(actor.snapshot().completed, 2);
    assert_eq!(actor.snapshot().superseded, 1);
}

#[test]
fn actor_rejects_non_replaceable_requests_after_queue_capacity() {
    let writes = Arc::new(Mutex::new(Vec::new()));
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let actor = Arc::new(SemanticRequestActor::start(Box::new(SlowTransport {
        current_id: String::new(),
        writes,
        first_started: started_tx,
        first_release: release_rx,
    })));

    let first = spawn_exchange(actor.clone(), "completion-1");
    started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
    let requests = (2..=20)
        .map(|index| {
            let actor = actor.clone();
            thread::spawn(move || {
                actor.exchange(
                    format!("usages-{index}"),
                    "usages".to_string(),
                    serde_json::json!({ "id": format!("usages-{index}"), "method": "usages" })
                        .to_string(),
                    None,
                    Duration::from_secs(1),
                )
            })
        })
        .collect::<Vec<_>>();

    wait_for_queued(&actor, 8);
    assert!(actor.snapshot().queued <= 8);
    release_tx.send(()).unwrap();
    first.join().unwrap();

    let results = requests
        .into_iter()
        .map(|request| request.join().unwrap())
        .collect::<Vec<_>>();
    assert!(results.iter().any(|result| result
        .as_deref()
        .err()
        .is_some_and(|error| { error.contains("request queue is full") })));
}

#[test]
fn actor_preserves_transport_timeout_during_delayed_delivery_and_cleanup() {
    let actor = SemanticRequestActor::start(Box::new(SlowTerminateTransport));

    let error = actor
        .exchange(
            "health-1".to_string(),
            "health".to_string(),
            serde_json::json!({ "id": "health-1", "method": "health" }).to_string(),
            None,
            Duration::from_millis(20),
        )
        .unwrap_err();

    assert!(error.contains("Timed out waiting for semantic worker response"));
}

fn wait_for_queued(actor: &SemanticRequestActor, expected: usize) {
    for _ in 0..100 {
        if actor.snapshot().queued >= expected {
            return;
        }
        thread::sleep(Duration::from_millis(1));
    }
    panic!("semantic actor did not queue {expected} requests");
}

fn spawn_exchange(
    actor: Arc<SemanticRequestActor>,
    request_id: &'static str,
) -> thread::JoinHandle<Value> {
    spawn_exchange_with_method(actor, "completion", request_id)
}

fn spawn_exchange_with_method(
    actor: Arc<SemanticRequestActor>,
    method: &'static str,
    request_id: &'static str,
) -> thread::JoinHandle<Value> {
    thread::spawn(move || {
        let line = actor
            .exchange(
                request_id.to_string(),
                method.to_string(),
                serde_json::json!({ "id": request_id, "method": method }).to_string(),
                None,
                Duration::from_secs(1),
            )
            .unwrap();
        serde_json::from_str(&line).unwrap()
    })
}
