use std::thread;
use std::time::Duration;

use crate::services::workspace_query_broker_service::WorkspaceQueryBrokerRuntime;
use crate::services::workspace_search_session_service::WorkspaceSearchSessionRuntime;

#[test]
fn newer_generation_supersedes_previous_ticket() {
    let broker = broker();
    let first = broker
        .begin("/workspace", "searchEverywhere", Some(1), 1_000)
        .unwrap();
    let second = broker
        .begin("/workspace", "searchEverywhere", Some(2), 1_000)
        .unwrap();

    assert_eq!(first.check().unwrap_err(), "Workspace query superseded");
    assert!(second.check().is_ok());
}

#[test]
fn cancellation_invalidates_matching_ticket_only() {
    let broker = broker();
    let entity = broker
        .begin("/workspace", "searchEverywhere", Some(4), 1_000)
        .unwrap();
    let text = broker.begin("/workspace", "text", Some(4), 1_000).unwrap();

    broker.cancel("/workspace", "searchEverywhere", 4).unwrap();

    assert!(entity.should_cancel());
    assert!(!text.should_cancel());
}

#[test]
fn ticket_deadline_is_monotonic_and_cooperative() {
    let ticket = broker().begin("/workspace", "text", Some(1), 1).unwrap();

    thread::sleep(Duration::from_millis(5));

    assert!(ticket.deadline_exceeded());
    assert!(ticket.should_cancel());
    assert_eq!(
        ticket.check().unwrap_err(),
        "Workspace query deadline exceeded"
    );
}

fn broker() -> WorkspaceQueryBrokerRuntime {
    WorkspaceQueryBrokerRuntime::new(WorkspaceSearchSessionRuntime::default())
}
