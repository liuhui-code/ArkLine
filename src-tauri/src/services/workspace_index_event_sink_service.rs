use std::collections::BTreeMap;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::OnceLock;
use std::time::Duration;

use crate::models::workspace::WorkspaceIndexEvent;
use crate::services::workspace_index_event_service::store_index_events;

const EVENT_QUEUE_CAPACITY: usize = 256;
const EVENT_BATCH_LIMIT: usize = 32;
const EVENT_BATCH_WAIT: Duration = Duration::from_millis(25);
const FLUSH_WAIT: Duration = Duration::from_secs(2);

enum EventSinkMessage {
    Record {
        root_path: String,
        event: WorkspaceIndexEvent,
    },
    Flush(mpsc::Sender<()>),
}

pub(crate) fn enqueue_index_event(root_path: &str, event: WorkspaceIndexEvent) {
    let message = EventSinkMessage::Record {
        root_path: root_path.to_string(),
        event,
    };
    match event_sink().try_send(message) {
        Ok(()) | Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {}
    }
}

pub(crate) fn flush_index_events() {
    let (acknowledge, receiver) = mpsc::channel();
    if event_sink()
        .send(EventSinkMessage::Flush(acknowledge))
        .is_ok()
    {
        let _ = receiver.recv_timeout(FLUSH_WAIT);
    }
}

fn event_sink() -> &'static SyncSender<EventSinkMessage> {
    static SINK: OnceLock<SyncSender<EventSinkMessage>> = OnceLock::new();
    SINK.get_or_init(|| {
        let (sender, receiver) = mpsc::sync_channel(EVENT_QUEUE_CAPACITY);
        std::thread::Builder::new()
            .name("arkline-index-events".to_string())
            .spawn(move || run_event_sink(receiver))
            .expect("index event sink thread");
        sender
    })
}

fn run_event_sink(receiver: Receiver<EventSinkMessage>) {
    while let Ok(message) = receiver.recv() {
        match message {
            EventSinkMessage::Record { root_path, event } => {
                let mut batch = vec![(root_path, event)];
                let mut flush = None;
                while batch.len() < EVENT_BATCH_LIMIT {
                    match receiver.recv_timeout(EVENT_BATCH_WAIT) {
                        Ok(EventSinkMessage::Record { root_path, event }) => {
                            batch.push((root_path, event));
                        }
                        Ok(EventSinkMessage::Flush(acknowledge)) => {
                            flush = Some(acknowledge);
                            break;
                        }
                        Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => break,
                    }
                }
                persist_batch(batch);
                if let Some(acknowledge) = flush {
                    let _ = acknowledge.send(());
                }
            }
            EventSinkMessage::Flush(acknowledge) => {
                let _ = acknowledge.send(());
            }
        }
    }
}

fn persist_batch(batch: Vec<(String, WorkspaceIndexEvent)>) {
    let mut events_by_root = BTreeMap::<String, Vec<WorkspaceIndexEvent>>::new();
    for (root_path, event) in batch {
        events_by_root.entry(root_path).or_default().push(event);
    }
    for (root_path, events) in events_by_root {
        let _ = store_index_events(&root_path, &events);
    }
}
