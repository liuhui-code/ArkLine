use serde_json::Value;

use super::SemanticWorkerSession;
use crate::models::language::LanguageQueryRequest;
use crate::services::semantic_host::protocol::{SemanticDocumentSync, SemanticRequest};

impl SemanticWorkerSession {
    pub fn prepare_document(&self, path: &str, document_version: u64) -> Result<(), String> {
        let request = LanguageQueryRequest {
            path: path.to_string(),
            line: 1,
            column: 1,
            content: None,
        };
        let response = self.send_request_parts(
            "prepareDocument",
            Some(&request),
            None,
            Some(document_version),
        )?;
        if response.payload.get("status").and_then(Value::as_str) != Some("ready") {
            return Err("Semantic worker document preparation did not become ready".to_string());
        }
        Ok(())
    }

    pub fn sync_document(
        &self,
        method: &str,
        path: &str,
        content: &str,
        document_version: u64,
        workspace_root: Option<&str>,
    ) -> Result<(), String> {
        if !matches!(method, "didOpen" | "didChange") {
            return Err(format!(
                "Unsupported semantic document sync method: {method}"
            ));
        }
        self.document_generations
            .lock()
            .map_err(|_| "Semantic document generation lock is poisoned".to_string())?
            .generation_for(path, Some(content));
        let response = self.send_payload(
            SemanticRequest {
                id: self.next_request_id(),
                method: method.to_string(),
                position: None,
                action: None,
                completion: None,
                documents: None,
                document: Some(SemanticDocumentSync {
                    path: path.to_string(),
                    content: content.to_string(),
                    document_version,
                    workspace_root: workspace_root.map(str::to_string),
                }),
                document_path: None,
            },
            None,
        )?;
        if response.payload.get("status").and_then(Value::as_str) != Some("ready") {
            return Err("Semantic worker document sync did not become ready".to_string());
        }
        Ok(())
    }

    pub fn close_document(&self, path: &str) -> Result<(), String> {
        let response = self.send_payload(
            SemanticRequest {
                id: self.next_request_id(),
                method: "didClose".to_string(),
                position: None,
                action: None,
                completion: None,
                documents: None,
                document: None,
                document_path: Some(path.to_string()),
            },
            None,
        )?;
        if response.payload.get("status").and_then(Value::as_str) != Some("closed") {
            return Err("Semantic worker document close was not acknowledged".to_string());
        }
        self.document_generations
            .lock()
            .map_err(|_| "Semantic document generation lock is poisoned".to_string())?
            .close(path);
        Ok(())
    }
}
