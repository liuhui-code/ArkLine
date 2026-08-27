use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::models::language::LanguageQueryRequest;
use crate::services::semantic_host::session::SemanticWorkerSession;
use crate::services::semantic_host::transport::SemanticWorkerTransport;

struct TimeoutRecordingTransport {
    request_id: String,
    observed_timeout: Arc<Mutex<Option<Duration>>>,
}

impl SemanticWorkerTransport for TimeoutRecordingTransport {
    fn process_id(&self) -> u32 {
        91
    }

    fn write_line(&mut self, line: &str) -> Result<(), String> {
        let request: serde_json::Value =
            serde_json::from_str(line).map_err(|error| error.to_string())?;
        self.request_id = request["id"].as_str().unwrap_or_default().to_string();
        Ok(())
    }

    fn recv_line(&mut self, timeout: Duration) -> Result<String, String> {
        *self.observed_timeout.lock().unwrap() = Some(timeout);
        Ok(serde_json::json!({
            "id": self.request_id,
            "ok": true,
            "payload": { "definition": null }
        })
        .to_string())
    }

    fn terminate(&mut self) {}
}

#[test]
fn definition_request_uses_the_foreground_deadline_instead_of_the_session_default() {
    let observed_timeout = Arc::new(Mutex::new(None));
    let session = SemanticWorkerSession::from_transport(Box::new(TimeoutRecordingTransport {
        request_id: String::new(),
        observed_timeout: observed_timeout.clone(),
    }));
    let foreground_timeout = Duration::from_millis(37);

    let candidates = session
        .goto_definition_candidates_with_document_version_and_timeout(
            &LanguageQueryRequest {
                path: "/workspace/Main.ets".to_string(),
                line: 1,
                column: 1,
                content: None,
            },
            Some(4),
            foreground_timeout,
        )
        .unwrap();

    assert!(candidates.is_empty());
    let observed = observed_timeout.lock().unwrap().unwrap();
    assert!(observed <= foreground_timeout);
    assert!(observed > Duration::ZERO);
}
