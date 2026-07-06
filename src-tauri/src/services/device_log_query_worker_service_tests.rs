use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::models::device_log_query::{
    DeviceLogQueryRequest, DeviceLogQueryResponse, DeviceLogQueryStopReason,
};
use crate::services::device_log_query_worker_service::DeviceLogQueryWorker;

#[test]
fn worker_supersedes_running_foreground_query_when_newer_query_is_submitted() {
    let (first_started_tx, first_started_rx) = mpsc::channel();
    let seen_cancel = Arc::new(Mutex::new(false));
    let seen_cancel_in_worker = seen_cancel.clone();
    let worker = DeviceLogQueryWorker::new(Arc::new(move |request, should_cancel| {
        if request.query == "first" {
            first_started_tx.send(()).expect("first started");
            let started = Instant::now();
            while !should_cancel() && started.elapsed() < Duration::from_secs(2) {
                thread::sleep(Duration::from_millis(5));
            }
            *seen_cancel_in_worker.lock().expect("seen cancel lock") = should_cancel();
            return Ok(response(DeviceLogQueryStopReason::Cancelled));
        }
        Ok(response(DeviceLogQueryStopReason::Complete))
    }));
    let first_worker = worker.clone();
    let first = thread::spawn(move || first_worker.submit_latest(request("stream-1", "first")));

    first_started_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("first query should start");
    let second = worker
        .submit_latest(request("stream-1", "second"))
        .expect("second response");
    let first = first.join().expect("first thread").expect("first response");

    assert_eq!(first.stop_reason, DeviceLogQueryStopReason::Cancelled);
    assert_eq!(second.stop_reason, DeviceLogQueryStopReason::Complete);
    assert!(*seen_cancel.lock().expect("seen cancel lock"));
}

#[test]
fn worker_reports_running_queued_and_terminal_query_counts() {
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = Arc::new(Mutex::new(release_rx));
    let release_rx_in_worker = release_rx.clone();
    let worker = DeviceLogQueryWorker::new(Arc::new(move |request, should_cancel| {
        if request.query == "first" {
            release_rx_in_worker
                .lock()
                .expect("release lock")
                .recv()
                .expect("release first query");
            return Ok(response(if should_cancel() {
                DeviceLogQueryStopReason::Cancelled
            } else {
                DeviceLogQueryStopReason::Complete
            }));
        }
        Ok(response(DeviceLogQueryStopReason::Complete))
    }));
    let first_worker = worker.clone();
    let first = thread::spawn(move || first_worker.submit_latest(request("stream-1", "first")));
    wait_for(|| worker.stats().running);
    let second_worker = worker.clone();
    let second = thread::spawn(move || second_worker.submit_latest(request("stream-1", "second")));
    wait_for(|| worker.stats().queued >= 1);

    release_tx.send(()).expect("release first query");
    let first = first.join().expect("first thread").expect("first response");
    let second = second
        .join()
        .expect("second thread")
        .expect("second response");
    let stats = worker.stats();

    assert_eq!(first.stop_reason, DeviceLogQueryStopReason::Cancelled);
    assert_eq!(second.stop_reason, DeviceLogQueryStopReason::Complete);
    assert_eq!(stats.running, false);
    assert_eq!(stats.queued, 0);
    assert_eq!(stats.completed_queries, 1);
    assert_eq!(stats.cancelled_queries, 1);
    assert_eq!(stats.failed_queries, 0);
}

#[test]
fn worker_records_recent_query_events_with_terminal_status() {
    let worker = DeviceLogQueryWorker::new(Arc::new(move |request, _should_cancel| {
        if request.query == "fail" {
            return Err("query exploded".to_string());
        }
        Ok(response(DeviceLogQueryStopReason::Complete))
    }));

    worker
        .submit_latest(request("stream-1", "ok"))
        .expect("ok response");
    let failed = worker.submit_latest(request("stream-1", "fail"));
    let events = worker.recent_events();

    assert!(failed.is_err());
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].query, "ok");
    assert_eq!(events[0].status, "completed");
    assert_eq!(events[1].query, "fail");
    assert_eq!(events[1].status, "failed");
    assert_eq!(events[1].error.as_deref(), Some("query exploded"));
}

#[test]
fn worker_keeps_recent_query_event_history_bounded() {
    let worker = DeviceLogQueryWorker::new(Arc::new(move |_request, _should_cancel| {
        Ok(response(DeviceLogQueryStopReason::Complete))
    }));

    for index in 0..70 {
        worker
            .submit_latest(request("stream-1", &format!("query-{index}")))
            .expect("query response");
    }
    let events = worker.recent_events();

    assert_eq!(events.len(), 64);
    assert_eq!(events[0].query, "query-6");
    assert_eq!(events[63].query, "query-69");
}

fn request(stream_id: &str, query: &str) -> DeviceLogQueryRequest {
    let mut request = DeviceLogQueryRequest::recent(stream_id);
    request.query = query.to_string();
    request
}

fn response(stop_reason: DeviceLogQueryStopReason) -> DeviceLogQueryResponse {
    DeviceLogQueryResponse {
        rows: Vec::new(),
        total_candidates: 0,
        scanned_lines: 0,
        truncated: false,
        next_cursor_seq: None,
        continuation_cursor_seq: None,
        continuation_reason: "none".to_string(),
        budget_exceeded: false,
        stop_reason,
        query_ms: 0,
    }
}

fn wait_for(mut predicate: impl FnMut() -> bool) {
    let started = Instant::now();
    while !predicate() {
        assert!(started.elapsed() < Duration::from_secs(2));
        thread::sleep(Duration::from_millis(5));
    }
}
