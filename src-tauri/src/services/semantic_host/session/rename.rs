use super::super::protocol::SemanticRequest;
use super::SemanticWorkerSession;
use crate::models::language::{CodeActionResolution, LanguageQueryRequest, RenameSymbolResult};

impl SemanticWorkerSession {
    pub fn rename_symbol(
        &self,
        request: &LanguageQueryRequest,
        new_name: &str,
        document_version: Option<u64>,
    ) -> Result<RenameSymbolResult, String> {
        let content_generation = self
            .document_generations
            .lock()
            .map_err(|_| "Semantic document generation lock is poisoned".to_string())?
            .generation_for(&request.path, request.content.as_deref());
        let mut payload = SemanticRequest::rename_symbol(
            self.next_request_id(),
            request.path.clone(),
            request.line,
            request.column,
            new_name.to_string(),
            document_version,
        );
        if let Some(position) = payload.position.as_mut() {
            position.content = request.content.clone();
            position.content_generation = content_generation;
        }
        let response = self.send_payload(
            payload,
            content_generation,
            super::SEMANTIC_WORKER_REQUEST_TIMEOUT,
        )?;
        let resolution: CodeActionResolution = serde_json::from_value(response.payload)
            .map_err(|error| format!("Failed to parse semantic worker rename result: {error}"))?;
        if let CodeActionResolution::Unsupported(unsupported) = &resolution {
            return Ok(RenameSymbolResult::unavailable(unsupported.reason.clone()));
        }
        Ok(
            match response
                .state
                .as_ref()
                .and_then(|state| state.type_status.as_deref())
            {
                Some("ready") => RenameSymbolResult::ready(resolution),
                Some("partial") => RenameSymbolResult::partial(
                    resolution,
                    "Semantic type evidence is partial; rename may miss references",
                ),
                _ => RenameSymbolResult::unavailable(
                    "Semantic worker could not provide authoritative rename evidence",
                ),
            },
        )
    }
}
