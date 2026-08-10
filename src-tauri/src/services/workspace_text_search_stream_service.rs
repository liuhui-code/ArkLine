use serde::Serialize;
use tauri::async_runtime::spawn_blocking;

use crate::models::workspace::{WorkspaceTextSearchRequest, WorkspaceTextSearchResult};
use crate::services::workspace_index_facade_service::query_facade_text_search_result_with_cancellation;
use crate::services::workspace_index_service::WorkspaceIndexRuntime;
use crate::services::workspace_index_task_status_service::current_time_millis;
use crate::services::workspace_index_ui_activity_service::{
    WorkspaceIndexUiActivityKind, WorkspaceIndexUiActivityRuntime,
};
use crate::services::workspace_index_writer_actor_service::WorkspaceIndexWriterActor;
use crate::services::workspace_query_broker_service::WorkspaceQueryBrokerRuntime;
use crate::services::workspace_text_search_cancellation_service::WorkspaceTextSearchCancellationRuntime;

const STREAM_QUERY_DEADLINE_MS: u64 = 30_000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceTextSearchStreamStatus {
    Complete,
    Partial,
    Cancelled,
    Deadline,
    Failed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "event", rename_all = "camelCase")]
pub(crate) enum WorkspaceTextSearchStreamEvent {
    Started {
        generation: u64,
    },
    Batch {
        generation: u64,
        sequence: usize,
        result: WorkspaceTextSearchResult,
    },
    Finished {
        generation: u64,
        sequence: usize,
        status: WorkspaceTextSearchStreamStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
}

pub(crate) async fn stream_workspace_text_blocking<E>(
    index_runtime: WorkspaceIndexRuntime,
    text_search_cancellation: WorkspaceTextSearchCancellationRuntime,
    query_broker: WorkspaceQueryBrokerRuntime,
    ui_activity: WorkspaceIndexUiActivityRuntime,
    request: WorkspaceTextSearchRequest,
    emit: E,
) -> Result<(), String>
where
    E: FnMut(WorkspaceTextSearchStreamEvent) -> Result<(), String> + Send + 'static,
{
    let root_path = request.root_path.clone();
    let generation = request
        .generation
        .ok_or_else(|| "Streaming workspace text search requires a generation".to_string())?;
    ui_activity.record_ui_activity(
        WorkspaceIndexUiActivityKind::SearchInput,
        current_time_millis() as u64,
    )?;
    text_search_cancellation.register_generation(&root_path, generation)?;
    let ticket = query_broker.begin(
        &root_path,
        "text",
        Some(generation),
        STREAM_QUERY_DEADLINE_MS,
    )?;

    spawn_blocking(move || {
        let search_ticket = ticket.clone();
        let search_cancellation = text_search_cancellation.clone();
        let search_root = root_path.clone();
        drive_text_search_stream(
            request,
            move |request| {
                let _foreground_read = WorkspaceIndexWriterActor::shared().begin_foreground_read();
                let page_ticket = search_ticket.clone();
                let page_cancellation = search_cancellation.clone();
                let page_root = search_root.clone();
                query_facade_text_search_result_with_cancellation(
                    &index_runtime,
                    request.clone(),
                    move || {
                        page_ticket.should_cancel()
                            || page_cancellation
                                .is_generation_stale(&page_root, generation)
                                .unwrap_or(false)
                    },
                )
            },
            emit,
            move || {
                if ticket.deadline_exceeded() {
                    return Some(WorkspaceTextSearchStreamStatus::Deadline);
                }
                if ticket.should_cancel()
                    || text_search_cancellation
                        .is_generation_stale(&root_path, generation)
                        .unwrap_or(false)
                {
                    return Some(WorkspaceTextSearchStreamStatus::Cancelled);
                }
                None
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn drive_text_search_stream<P, E, S>(
    mut request: WorkspaceTextSearchRequest,
    mut search_page: P,
    mut emit: E,
    mut stop_status: S,
) -> Result<(), String>
where
    P: FnMut(&WorkspaceTextSearchRequest) -> Result<WorkspaceTextSearchResult, String>,
    E: FnMut(WorkspaceTextSearchStreamEvent) -> Result<(), String>,
    S: FnMut() -> Option<WorkspaceTextSearchStreamStatus>,
{
    let generation = request
        .generation
        .ok_or_else(|| "Streaming workspace text search requires a generation".to_string())?;
    emit(WorkspaceTextSearchStreamEvent::Started { generation })?;
    let mut sequence = 0;

    loop {
        if let Some(status) = stop_status() {
            return finish(&mut emit, generation, sequence, status, None);
        }
        let result = match search_page(&request) {
            Ok(result) => result,
            Err(message) => {
                let status = stop_status().unwrap_or(WorkspaceTextSearchStreamStatus::Failed);
                let message =
                    (status == WorkspaceTextSearchStreamStatus::Failed).then_some(message);
                return finish(&mut emit, generation, sequence, status, message);
            }
        };
        let next_cursor = result.next_cursor.clone();
        let partial = result.partial;
        emit(WorkspaceTextSearchStreamEvent::Batch {
            generation,
            sequence,
            result,
        })?;
        sequence += 1;

        if let Some(status) = stop_status() {
            return finish(&mut emit, generation, sequence, status, None);
        }
        let Some(next_cursor) = next_cursor else {
            let status = if partial {
                WorkspaceTextSearchStreamStatus::Partial
            } else {
                WorkspaceTextSearchStreamStatus::Complete
            };
            return finish(&mut emit, generation, sequence, status, None);
        };
        if request.cursor.as_ref() == Some(&next_cursor) {
            return finish(
                &mut emit,
                generation,
                sequence,
                WorkspaceTextSearchStreamStatus::Failed,
                Some("Workspace text search cursor did not advance".to_string()),
            );
        }
        request.cursor = Some(next_cursor);
    }
}

fn finish<E>(
    emit: &mut E,
    generation: u64,
    sequence: usize,
    status: WorkspaceTextSearchStreamStatus,
    message: Option<String>,
) -> Result<(), String>
where
    E: FnMut(WorkspaceTextSearchStreamEvent) -> Result<(), String>,
{
    emit(WorkspaceTextSearchStreamEvent::Finished {
        generation,
        sequence,
        status,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        drive_text_search_stream, WorkspaceTextSearchStreamEvent, WorkspaceTextSearchStreamStatus,
    };
    use crate::models::workspace::{
        WorkspaceTextSearchCursor, WorkspaceTextSearchOptions, WorkspaceTextSearchQuery,
        WorkspaceTextSearchRequest, WorkspaceTextSearchResult,
    };

    #[test]
    fn stream_emits_ordered_batches_until_the_cursor_is_exhausted() {
        let mut requested_cursors = Vec::new();
        let mut events = Vec::new();

        drive_text_search_stream(
            request(),
            |request| {
                requested_cursors.push(request.cursor.clone());
                Ok(page(request.cursor.is_none()))
            },
            |event| {
                events.push(event);
                Ok(())
            },
            || None,
        )
        .unwrap();

        assert_eq!(
            requested_cursors,
            vec![
                None,
                Some(WorkspaceTextSearchCursor {
                    path_index: 1,
                    line_index: 0,
                    source: Some("filesystem".to_string()),
                }),
            ]
        );
        assert!(matches!(
            events.as_slice(),
            [
                WorkspaceTextSearchStreamEvent::Started { generation: 7 },
                WorkspaceTextSearchStreamEvent::Batch {
                    generation: 7,
                    sequence: 0,
                    ..
                },
                WorkspaceTextSearchStreamEvent::Batch {
                    generation: 7,
                    sequence: 1,
                    ..
                },
                WorkspaceTextSearchStreamEvent::Finished {
                    generation: 7,
                    sequence: 2,
                    ..
                }
            ]
        ));
    }

    #[test]
    fn stream_reports_cancellation_without_requesting_another_page() {
        let mut events = Vec::new();
        let mut stop_checks = 0;
        drive_text_search_stream(
            request(),
            |_| Ok(page(true)),
            |event| {
                events.push(event);
                Ok(())
            },
            || {
                stop_checks += 1;
                (stop_checks > 1).then_some(WorkspaceTextSearchStreamStatus::Cancelled)
            },
        )
        .unwrap();

        assert!(matches!(
            events.last(),
            Some(WorkspaceTextSearchStreamEvent::Finished {
                status: WorkspaceTextSearchStreamStatus::Cancelled,
                sequence: 1,
                ..
            })
        ));
    }

    #[test]
    fn stream_continues_after_an_empty_partial_probe_with_a_filesystem_cursor() {
        let mut requested_cursors = Vec::new();
        let mut events = Vec::new();
        drive_text_search_stream(
            request(),
            |request| {
                requested_cursors.push(request.cursor.clone());
                let mut result = page(request.cursor.is_none());
                if request.cursor.is_some() {
                    result.matches.push(match_result());
                }
                Ok(result)
            },
            |event| {
                events.push(event);
                Ok(())
            },
            || None,
        )
        .unwrap();

        assert_eq!(requested_cursors.len(), 2);
        assert!(matches!(
            events.get(1),
            Some(WorkspaceTextSearchStreamEvent::Batch { result, .. }) if result.matches.is_empty()
        ));
        assert!(matches!(
            events.get(2),
            Some(WorkspaceTextSearchStreamEvent::Batch { result, .. }) if result.matches.len() == 1
        ));
    }

    #[test]
    fn stream_continues_past_eight_resumable_pages() {
        let mut page_count = 0;
        let mut events = Vec::new();
        drive_text_search_stream(
            request(),
            |_| {
                page_count += 1;
                let mut result = page(false);
                if page_count < 10 {
                    result.partial = true;
                    result.next_cursor = Some(WorkspaceTextSearchCursor {
                        path_index: page_count,
                        line_index: 0,
                        source: Some("filesystem".to_string()),
                    });
                }
                Ok(result)
            },
            |event| {
                events.push(event);
                Ok(())
            },
            || None,
        )
        .unwrap();

        assert_eq!(page_count, 10);
        assert!(matches!(
            events.last(),
            Some(WorkspaceTextSearchStreamEvent::Finished {
                status: WorkspaceTextSearchStreamStatus::Complete,
                sequence: 10,
                ..
            })
        ));
    }

    #[test]
    fn stream_stops_when_its_deadline_is_observed_between_pages() {
        let mut page_count = 0;
        let mut events = Vec::new();
        let mut stop_checks = 0;
        drive_text_search_stream(
            request(),
            |request| {
                page_count += 1;
                let mut result = page(true);
                result.next_cursor = Some(WorkspaceTextSearchCursor {
                    path_index: request
                        .cursor
                        .as_ref()
                        .map_or(1, |cursor| cursor.path_index + 1),
                    line_index: 0,
                    source: Some("filesystem".to_string()),
                });
                Ok(result)
            },
            |event| {
                events.push(event);
                Ok(())
            },
            || {
                stop_checks += 1;
                (stop_checks > 3).then_some(WorkspaceTextSearchStreamStatus::Deadline)
            },
        )
        .unwrap();

        assert_eq!(page_count, 2);
        assert!(matches!(
            events.last(),
            Some(WorkspaceTextSearchStreamEvent::Finished {
                status: WorkspaceTextSearchStreamStatus::Deadline,
                sequence: 2,
                ..
            })
        ));
    }

    #[test]
    fn stream_event_serialization_matches_the_frontend_channel_contract() {
        let value = serde_json::to_value(WorkspaceTextSearchStreamEvent::Finished {
            generation: 5,
            sequence: 3,
            status: WorkspaceTextSearchStreamStatus::Deadline,
            message: None,
        })
        .unwrap();

        assert_eq!(value["event"], "finished");
        assert_eq!(value["generation"], 5);
        assert_eq!(value["sequence"], 3);
        assert_eq!(value["status"], "deadline");
        assert!(value.get("message").is_none());
    }

    fn request() -> WorkspaceTextSearchRequest {
        WorkspaceTextSearchRequest {
            root_path: "/workspace".to_string(),
            query: "target".to_string(),
            generation: Some(7),
            cursor: None,
            options: WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: false,
            },
            limit: 50,
            context_lines: 0,
        }
    }

    fn page(first: bool) -> WorkspaceTextSearchResult {
        WorkspaceTextSearchResult {
            query: WorkspaceTextSearchQuery::Text {
                query: "target".to_string(),
            },
            matches: Vec::new(),
            partial: first,
            searched_files: 1,
            prefilter_skipped_files: 0,
            limit_reached: false,
            next_cursor: first.then_some(WorkspaceTextSearchCursor {
                path_index: 1,
                line_index: 0,
                source: Some("filesystem".to_string()),
            }),
        }
    }

    fn match_result() -> crate::models::workspace::WorkspaceTextSearchMatch {
        crate::models::workspace::WorkspaceTextSearchMatch {
            path: "/workspace/Entry.ets".to_string(),
            relative_path: "Entry.ets".to_string(),
            file_name: "Entry.ets".to_string(),
            line: 1,
            column: 1,
            summary: "target".to_string(),
            preview: "target".to_string(),
            preview_start: 0,
            preview_end: 6,
            context_before: Vec::new(),
            context_after: Vec::new(),
        }
    }
}
