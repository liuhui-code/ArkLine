use std::sync::mpsc;
use std::time::Duration;

use tauri::async_runtime::spawn;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LanguageClientSource {
    Hover,
    Definition,
    DefinitionCandidates,
    Completion,
    DocumentSymbols,
    Usages,
}

impl LanguageClientSource {
    fn as_str(self) -> &'static str {
        match self {
            LanguageClientSource::Hover => "hover",
            LanguageClientSource::Definition => "definition",
            LanguageClientSource::DefinitionCandidates => "definitionCandidates",
            LanguageClientSource::Completion => "completion",
            LanguageClientSource::DocumentSymbols => "documentSymbols",
            LanguageClientSource::Usages => "usages",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LanguageClientRequest {
    pub request_id: u64,
    pub generation: u64,
    pub timeout_ms: u64,
    pub source: LanguageClientSource,
}

impl LanguageClientRequest {
    pub fn new(source: LanguageClientSource, request_id: u64, generation: u64, timeout_ms: u64) -> Self {
        Self { source, request_id, generation, timeout_ms }
    }
}

pub async fn run_language_request<T, Fut>(
    request: LanguageClientRequest,
    operation: Fut,
) -> Result<T, String>
where
    T: Send + 'static,
    Fut: std::future::Future<Output = Result<T, String>> + Send + 'static,
{
    let (sender, receiver) = mpsc::channel();
    spawn(async move {
        let _ = sender.send(operation.await);
    });
    receiver
        .recv_timeout(Duration::from_millis(request.timeout_ms))
        .map_err(|_| timeout_message(request))?
}

fn timeout_message(request: LanguageClientRequest) -> String {
    format!(
        "Language {} request {} generation {} timed out after {}ms",
        request.source.as_str(),
        request.request_id,
        request.generation,
        request.timeout_ms
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn timeout_message_includes_request_metadata() {
        let request = LanguageClientRequest::new(LanguageClientSource::Completion, 7, 11, 2500);

        assert_eq!(
            timeout_message(request),
            "Language completion request 7 generation 11 timed out after 2500ms"
        );
    }

    #[test]
    fn run_language_request_times_out() {
        let request = LanguageClientRequest::new(LanguageClientSource::Usages, 3, 3, 5);

        let error = tauri::async_runtime::block_on(run_language_request(request, async move {
            thread::sleep(Duration::from_millis(50));
            Ok::<_, String>(Vec::<String>::new())
        }))
        .expect_err("slow language request should time out");

        assert_eq!(error, "Language usages request 3 generation 3 timed out after 5ms");
    }
}
