use std::io::{BufRead, Read, Write};
use std::path::Path;

use super::protocol::{
    IndexerContentRefreshRequest, IndexerContentRefreshResult, IndexerDiscoveryRequest,
    IndexerDiscoveryResult, IndexerRequest, IndexerResponse, IndexerResponseTelemetry,
    IndexerStubRefreshRequest, IndexerStubRefreshResult,
};
use super::request_validation::{validate_content_refresh_request, validate_stub_refresh_request};
use crate::services::workspace_content_refresh_service::prepare_workspace_content_refresh;
use crate::services::workspace_discovery_runner_service::{
    prepare_workspace_discovery_chunk, publish_prepared_workspace_discovery_chunk,
};
use crate::services::workspace_discovery_service::WorkspaceDiscoveryCursor;
use crate::services::workspace_index_connection_service::workspace_index_writer_metrics;
use crate::services::workspace_index_publication_artifact_service::{
    write_workspace_publication_artifact, WorkspaceIndexPublicationArtifact,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;
use crate::services::workspace_stub_index_service::normalize_index_path;
use crate::services::workspace_stub_prepare_service::prepare_changed_stub_rows;
use crate::services::workspace_stub_refresh_chunk_service::workspace_file_catalog_contains_paths;

const INDEXER_REQUEST_BYTE_LIMIT: usize = 512 * 1024;

pub(super) fn run_stream(mut reader: impl BufRead, mut writer: impl Write) -> Result<(), String> {
    loop {
        let line = match read_request_line(&mut reader)? {
            RequestLine::Eof => break,
            RequestLine::TooLarge => {
                write_response(
                    &mut writer,
                    &IndexerResponse {
                        id: "invalid".to_string(),
                        ok: false,
                        payload: serde_json::Value::Null,
                        telemetry: None,
                        error: Some("Indexer request exceeded the 512 KiB limit".to_string()),
                    },
                )?;
                continue;
            }
            RequestLine::Line(line) => line,
        };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<IndexerRequest>(&line) {
            Ok(request) => handle_request(request),
            Err(error) => IndexerResponse {
                id: "invalid".to_string(),
                ok: false,
                payload: serde_json::Value::Null,
                telemetry: None,
                error: Some(format!("Invalid indexer request: {error}")),
            },
        };
        write_response(&mut writer, &response)?;
    }
    Ok(())
}

enum RequestLine {
    Eof,
    TooLarge,
    Line(String),
}

fn read_request_line(reader: &mut impl BufRead) -> Result<RequestLine, String> {
    let mut line = String::new();
    let bytes = reader
        .by_ref()
        .take((INDEXER_REQUEST_BYTE_LIMIT + 1) as u64)
        .read_line(&mut line)
        .map_err(|error| format!("Failed to read indexer request: {error}"))?;
    if bytes == 0 {
        return Ok(RequestLine::Eof);
    }
    if bytes > INDEXER_REQUEST_BYTE_LIMIT {
        if !line.ends_with('\n') {
            discard_until_newline(reader)?;
        }
        return Ok(RequestLine::TooLarge);
    }
    Ok(RequestLine::Line(line))
}

fn discard_until_newline(reader: &mut impl BufRead) -> Result<(), String> {
    loop {
        let buffer = reader
            .fill_buf()
            .map_err(|error| format!("Failed to discard oversized indexer request: {error}"))?;
        if buffer.is_empty() {
            return Ok(());
        }
        if let Some(index) = buffer.iter().position(|byte| *byte == b'\n') {
            reader.consume(index + 1);
            return Ok(());
        }
        let length = buffer.len();
        reader.consume(length);
    }
}

fn handle_request(request: IndexerRequest) -> IndexerResponse {
    match request.method.as_str() {
        "health" => IndexerResponse::health(request.id),
        "prepareDiscoveryChunk" => handle_discovery_request(request, true),
        "discoverWorkspaceChunk" => handle_discovery_request(request, false),
        "prepareContentChunk" | "refreshContentChunk" => handle_content_refresh_request(request),
        "prepareStubChunk" | "refreshStubChunk" => handle_stub_refresh_request(request),
        method => IndexerResponse::unsupported(request.id, method),
    }
}

fn handle_content_refresh_request(request: IndexerRequest) -> IndexerResponse {
    let result = request
        .payload
        .ok_or_else(|| "Content refresh request omitted payload".to_string())
        .and_then(|payload| {
            serde_json::from_value::<IndexerContentRefreshRequest>(payload)
                .map_err(|error| format!("Invalid content refresh payload: {error}"))
        })
        .and_then(run_content_refresh);
    match result {
        Ok(result) => IndexerResponse {
            id: request.id,
            ok: true,
            telemetry: Some(writer_telemetry(&result.task.root_path)),
            payload: serde_json::to_value(result).unwrap_or(serde_json::Value::Null),
            error: None,
        },
        Err(error) => IndexerResponse {
            id: request.id,
            ok: false,
            payload: serde_json::Value::Null,
            telemetry: None,
            error: Some(error),
        },
    }
}

fn handle_stub_refresh_request(request: IndexerRequest) -> IndexerResponse {
    let result = request
        .payload
        .ok_or_else(|| "Stub refresh request omitted payload".to_string())
        .and_then(|payload| {
            serde_json::from_value::<IndexerStubRefreshRequest>(payload)
                .map_err(|error| format!("Invalid stub refresh payload: {error}"))
        })
        .and_then(run_stub_refresh);
    match result {
        Ok(result) => IndexerResponse {
            id: request.id,
            ok: true,
            telemetry: Some(writer_telemetry(&result.task.root_path)),
            payload: serde_json::to_value(result).unwrap_or(serde_json::Value::Null),
            error: None,
        },
        Err(error) => IndexerResponse {
            id: request.id,
            ok: false,
            payload: serde_json::Value::Null,
            telemetry: None,
            error: Some(error),
        },
    }
}

fn handle_discovery_request(request: IndexerRequest, prepare_only: bool) -> IndexerResponse {
    let result = request
        .payload
        .ok_or_else(|| "Discovery request omitted payload".to_string())
        .and_then(|payload| {
            serde_json::from_value::<IndexerDiscoveryRequest>(payload)
                .map_err(|error| format!("Invalid discovery payload: {error}"))
        })
        .and_then(|request| run_discovery(request, prepare_only));
    match result {
        Ok(result) => IndexerResponse {
            id: request.id,
            ok: true,
            telemetry: Some(writer_telemetry(&result.task.root_path)),
            payload: serde_json::to_value(result).unwrap_or(serde_json::Value::Null),
            error: None,
        },
        Err(error) => IndexerResponse {
            id: request.id,
            ok: false,
            payload: serde_json::Value::Null,
            telemetry: None,
            error: Some(error),
        },
    }
}

fn writer_telemetry(root_path: &str) -> IndexerResponseTelemetry {
    IndexerResponseTelemetry {
        writer_metrics: workspace_index_writer_metrics(root_path),
    }
}

fn run_discovery(
    request: IndexerDiscoveryRequest,
    prepare_only: bool,
) -> Result<IndexerDiscoveryResult, String> {
    if request.task.kind != "discovery" {
        return Err("Discovery task kind must be discovery".to_string());
    }
    if request.task.generation == 0 {
        return Err("Discovery generation must be positive".to_string());
    }
    if !(1..=1024).contains(&request.limit) {
        return Err("Discovery chunk limit must be between 1 and 1024".to_string());
    }
    let cursor = request
        .pending_directories
        .map(|pending_directories| WorkspaceDiscoveryCursor {
            pending_directories,
        });
    let prepared = prepare_workspace_discovery_chunk(
        Path::new(&request.task.root_path),
        cursor,
        request.limit,
        request.task.generation as i64,
        Some(&request.task.reason),
    )?;
    let chunk = prepared.chunk.clone();
    let (publication_artifact, publication_profile) = if prepare_only {
        let root_path = request.task.root_path.clone();
        let artifact = write_workspace_publication_artifact(
            &root_path,
            &WorkspaceIndexPublicationArtifact::Discovery {
                root_path: root_path.clone(),
                prepared,
            },
        )?;
        (Some(artifact), Default::default())
    } else {
        (None, publish_prepared_workspace_discovery_chunk(&prepared)?)
    };
    Ok(IndexerDiscoveryResult {
        task: request.task,
        chunk_file_count: chunk.files.len(),
        excluded_count: chunk.excluded_count,
        has_more: chunk.has_more,
        pending_directories: chunk.cursor.map(|cursor| cursor.pending_directories),
        publication_artifact,
        publication_profile,
    })
}

fn run_stub_refresh(
    request: IndexerStubRefreshRequest,
) -> Result<IndexerStubRefreshResult, String> {
    validate_stub_refresh_request(&request)?;
    if !workspace_file_catalog_contains_paths(&request.task.root_path, &request.changed_paths)? {
        return Err("Stub refresh path is absent from workspace file index".to_string());
    }
    let prepared = prepare_changed_stub_rows(
        &normalize_index_path(&request.task.root_path),
        &request.changed_paths,
        &request.removed_paths,
        request.indexed_generation,
        WorkspaceIndexTaskPriority::Background,
    );
    let publication_artifact = write_workspace_publication_artifact(
        &request.task.root_path,
        &WorkspaceIndexPublicationArtifact::Stub {
            root_path: request.task.root_path.clone(),
            prepared: prepared.clone(),
        },
    )?;
    Ok(IndexerStubRefreshResult {
        changed_path_count: request.changed_paths.len(),
        removed_path_count: request.removed_paths.len(),
        parsed_file_count: prepared.stubs.len(),
        parse_error_count: prepared
            .stubs
            .iter()
            .map(|stub| stub.parse_errors.len())
            .sum(),
        publication_artifact: Some(publication_artifact),
        publication_profile: Default::default(),
        indexed_generation: request.indexed_generation,
        task: request.task,
    })
}

fn run_content_refresh(
    request: IndexerContentRefreshRequest,
) -> Result<IndexerContentRefreshResult, String> {
    validate_content_refresh_request(&request)?;
    if !workspace_file_catalog_contains_paths(&request.task.root_path, &request.changed_paths)? {
        return Err("Content refresh path is absent from workspace file index".to_string());
    }
    let prepared = prepare_workspace_content_refresh(
        &request.task.root_path,
        &request.changed_paths,
        &request.removed_paths,
        request.indexed_generation,
    );
    let publication_artifact = write_workspace_publication_artifact(
        &request.task.root_path,
        &WorkspaceIndexPublicationArtifact::Content {
            root_path: request.task.root_path.clone(),
            prepared: prepared.clone(),
        },
    )?;
    Ok(IndexerContentRefreshResult {
        changed_path_count: request.changed_paths.len(),
        removed_path_count: request.removed_paths.len(),
        indexed_file_count: prepared.files.len(),
        indexed_line_count: prepared.files.iter().map(|file| file.line_count).sum(),
        unreadable_file_count: prepared
            .failures
            .iter()
            .filter(|failure| !failure.resource_limited)
            .count(),
        resource_limited_file_count: prepared
            .failures
            .iter()
            .filter(|failure| failure.resource_limited)
            .count(),
        processed_source_bytes: prepared.source_bytes,
        publication_artifact: Some(publication_artifact),
        publication_profile: Default::default(),
        indexed_generation: request.indexed_generation,
        task: request.task,
    })
}

fn write_response(writer: &mut impl Write, response: &IndexerResponse) -> Result<(), String> {
    serde_json::to_writer(&mut *writer, response)
        .map_err(|error| format!("Failed to serialize indexer response: {error}"))?;
    writer
        .write_all(b"\n")
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Failed to write indexer response: {error}"))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::{run_stream, INDEXER_REQUEST_BYTE_LIMIT};
    use crate::indexer_sidecar::IndexerResponse;

    #[test]
    fn stdio_keeps_one_response_per_request_line() {
        let input = Cursor::new(
            b"{\"id\":\"one\",\"method\":\"health\"}\n{\"id\":\"two\",\"method\":\"executeTasks\"}\n",
        );
        let mut output = Vec::new();

        run_stream(input, &mut output).unwrap();

        let responses = String::from_utf8(output)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<IndexerResponse>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(responses.len(), 2);
        assert!(responses[0].ok);
        assert!(!responses[1].ok);
        assert!(responses[1]
            .error
            .as_deref()
            .unwrap()
            .contains("executeTasks"));
    }

    #[test]
    fn rejects_stub_refresh_payloads_larger_than_one_chunk() {
        let paths = (0..65)
            .map(|index| format!("/workspace/File{index}.ets"))
            .collect::<Vec<_>>();
        let request = serde_json::json!({
            "id": "oversized",
            "method": "refreshStubChunk",
            "payload": {
                "task": {
                    "rootPath": "/workspace",
                    "kind": "stub-refresh",
                    "generation": 1,
                    "reason": "test"
                },
                "indexedGeneration": 1,
                "changedPaths": paths,
                "removedPaths": [],
                "priority": "background"
            }
        });
        let input = Cursor::new(format!("{request}\n"));
        let mut output = Vec::new();

        run_stream(input, &mut output).unwrap();

        let response: IndexerResponse = serde_json::from_slice(&output).unwrap();
        assert!(!response.ok);
        assert!(response.error.unwrap().contains("between 1 and 64"));
    }

    #[test]
    fn discards_an_oversized_line_and_reads_the_next_request() {
        let oversized = "x".repeat(INDEXER_REQUEST_BYTE_LIMIT + 32);
        let health = r#"{"id":"health-after-large","method":"health"}"#;
        let input = Cursor::new(format!("{oversized}\n{health}\n"));
        let mut output = Vec::new();

        run_stream(input, &mut output).unwrap();

        let responses = String::from_utf8(output)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<IndexerResponse>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(responses.len(), 2);
        assert!(responses[0].error.as_deref().unwrap().contains("512 KiB"));
        assert_eq!(responses[1].id, "health-after-large");
        assert!(responses[1].ok);
    }

    #[test]
    fn rejects_duplicate_stub_paths_across_changed_and_removed_sets() {
        let request = serde_json::json!({
            "id": "duplicate",
            "method": "refreshStubChunk",
            "payload": {
                "task": {
                    "rootPath": "/workspace",
                    "kind": "stub-refresh",
                    "generation": 1,
                    "reason": "test"
                },
                "indexedGeneration": 1,
                "changedPaths": ["/workspace/File.ets"],
                "removedPaths": ["/workspace/File.ets"],
                "priority": "background"
            }
        });
        let mut output = Vec::new();

        run_stream(Cursor::new(format!("{request}\n")), &mut output).unwrap();

        let response: IndexerResponse = serde_json::from_slice(&output).unwrap();
        assert!(response.error.unwrap().contains("duplicate path"));
    }
}
