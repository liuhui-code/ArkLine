use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LanguageClientSource {
    Hover,
    Definition,
    DefinitionCandidates,
    Completion,
    SignatureHelp,
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
            LanguageClientSource::SignatureHelp => "signatureHelp",
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
    pub fn new(
        source: LanguageClientSource,
        request_id: u64,
        generation: u64,
        timeout_ms: u64,
    ) -> Self {
        Self {
            source,
            request_id,
            generation,
            timeout_ms,
        }
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
    tokio::time::timeout(Duration::from_millis(request.timeout_ms), operation)
        .await
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
            tokio::time::sleep(Duration::from_millis(50)).await;
            Ok::<_, String>(Vec::<String>::new())
        }))
        .expect_err("slow language request should time out");

        assert_eq!(
            error,
            "Language usages request 3 generation 3 timed out after 5ms"
        );
    }
}
