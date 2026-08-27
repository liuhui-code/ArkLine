use super::{
    extract_payload, parse_definition_candidate, parse_definition_target, SemanticWorkerSession,
};
use crate::models::language::{DefinitionCandidate, DefinitionTarget, LanguageQueryRequest};
use std::time::Duration;

impl SemanticWorkerSession {
    pub fn goto_definition(
        &self,
        request: &LanguageQueryRequest,
    ) -> Result<Option<DefinitionTarget>, String> {
        let response = self.send_request("gotoDefinition", Some(request))?;
        let payload = extract_payload(&response.payload, "definition");
        if payload.is_null() {
            return Ok(None);
        }
        if let Some(definition) = payload.get("definition") {
            if definition.is_null() {
                return Ok(None);
            }
            return parse_definition_target(definition).map(Some);
        }
        parse_definition_target(payload).map(Some)
    }

    pub fn goto_definition_candidates(
        &self,
        request: &LanguageQueryRequest,
    ) -> Result<Vec<DefinitionCandidate>, String> {
        self.goto_definition_candidates_with_document_version(request, None)
    }

    pub fn goto_definition_candidates_with_document_version(
        &self,
        request: &LanguageQueryRequest,
        document_version: Option<u64>,
    ) -> Result<Vec<DefinitionCandidate>, String> {
        self.goto_definition_candidates_with_document_version_and_timeout(
            request,
            document_version,
            super::SEMANTIC_WORKER_REQUEST_TIMEOUT,
        )
    }

    pub fn goto_definition_candidates_with_document_version_and_timeout(
        &self,
        request: &LanguageQueryRequest,
        document_version: Option<u64>,
        timeout: Duration,
    ) -> Result<Vec<DefinitionCandidate>, String> {
        let response = self.send_request_parts(
            "gotoDefinition",
            Some(request),
            None,
            document_version,
            timeout,
        )?;
        let payload = extract_payload(&response.payload, "definition");
        if payload.is_null() {
            return Ok(Vec::new());
        }
        if let Some(candidates) = payload.get("definitionCandidates") {
            let items = candidates.as_array().ok_or_else(|| {
                "Semantic worker definitionCandidates response was not an array".to_string()
            })?;
            return items
                .iter()
                .map(parse_definition_candidate)
                .collect::<Result<Vec<_>, _>>();
        }
        parse_definition_candidate(payload).map(|candidate| vec![candidate])
    }
}
