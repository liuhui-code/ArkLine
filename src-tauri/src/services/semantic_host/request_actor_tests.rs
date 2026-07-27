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

impl SemanticWorkerTransport for SlowTransport {
    fn process_id(&self) -> u32 {
        77
    }

    fn write_line(&mut self, line: &str) -> Result<(), String> {
        let request: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
        self.current_id = request["id"].as_str().unwrap_or_default().to_string();
        self.writes.lock().unwrap().push(self.current_id.clone());
        if self.current_id == "completion-1" {
            let _ = self.first_started.send(());
        }
        Ok(())
    }

    fn recv_line(&mut self, _timeout: Duration) -> Result<String, String> {
        if self.current_id == "completion-1" {
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
    thread::spawn(move || {
        let line = actor
            .exchange(
                request_id.to_string(),
                "completion".to_string(),
                serde_json::json!({ "id": request_id, "method": "completion" }).to_string(),
                None,
                Duration::from_secs(1),
            )
            .unwrap();
        serde_json::from_str(&line).unwrap()
    })
}
