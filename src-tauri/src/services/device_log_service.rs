use std::collections::HashMap;
use std::process::Child;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::models::device_log_query::{
    DeviceLogQueryRequest, DeviceLogQueryResponse, DeviceLogQueryWorkerEvent,
    DeviceLogQueryWorkerStats, DeviceLogRetentionApplyResult, DeviceLogRetentionPlan,
    DeviceLogRuntimeStats, DeviceLogStorageClearResult, DeviceLogStorageHealth,
};
use crate::services::device_log_buffer_service::{
    apply_persisted_device_log_retention, clear_persisted_device_log_storage, create_stream_sink,
    inspect_persisted_device_log_storage, plan_persisted_device_log_retention,
    query_persisted_device_logs, query_persisted_device_logs_cancellable,
};
use crate::services::device_log_query_worker_service::DeviceLogQueryWorker;
use crate::services::device_log_runtime_service::DeviceLogRuntimeState;
use crate::services::device_log_stream_service::DeviceLogBatchSink;

pub struct DeviceLogRuntime {
    streams: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    query_worker: DeviceLogQueryWorker,
    next_id: AtomicU64,
    stats: Arc<DeviceLogRuntimeState>,
}

impl Default for DeviceLogRuntime {
    fn default() -> Self {
        Self {
            streams: Mutex::new(HashMap::new()),
            query_worker: DeviceLogQueryWorker::new(Arc::new(|request, should_cancel| {
                query_persisted_device_logs_cancellable(request, should_cancel)
            })),
            next_id: AtomicU64::new(0),
            stats: Arc::new(DeviceLogRuntimeState::default()),
        }
    }
}

impl DeviceLogRuntime {
    pub fn stats_for(&self, stream_id: &str) -> Option<DeviceLogRuntimeStats> {
        self.stats.stats_for(stream_id)
    }

    pub fn query_logs(
        &self,
        request: &DeviceLogQueryRequest,
    ) -> Result<DeviceLogQueryResponse, String> {
        query_persisted_device_logs(request)
    }

    pub fn query_latest_logs(
        &self,
        request: &DeviceLogQueryRequest,
    ) -> Result<DeviceLogQueryResponse, String> {
        self.query_worker.submit_latest(request.clone())
    }

    pub fn query_worker_stats(&self) -> DeviceLogQueryWorkerStats {
        self.query_worker.stats()
    }

    pub fn query_worker_events(&self) -> Vec<DeviceLogQueryWorkerEvent> {
        self.query_worker.recent_events()
    }

    pub fn storage_health(&self) -> Result<DeviceLogStorageHealth, String> {
        inspect_persisted_device_log_storage()
    }

    pub fn clear_storage(&self) -> Result<DeviceLogStorageClearResult, String> {
        if !self
            .streams
            .lock()
            .expect("device log stream lock")
            .is_empty()
        {
            return Err("Stop Device Log streams before clearing storage".to_string());
        }
        clear_persisted_device_log_storage()
    }

    pub fn retention_plan(&self, target_bytes: u64) -> Result<DeviceLogRetentionPlan, String> {
        plan_persisted_device_log_retention(target_bytes)
    }

    pub fn apply_retention(
        &self,
        target_bytes: u64,
    ) -> Result<DeviceLogRetentionApplyResult, String> {
        if !self
            .streams
            .lock()
            .expect("device log stream lock")
            .is_empty()
        {
            return Err("Stop Device Log streams before applying retention".to_string());
        }
        apply_persisted_device_log_retention(target_bytes)
    }

    pub(crate) fn next_stream_id(&self) -> String {
        let stream_number = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        format!("device-log-{stream_number}")
    }

    pub(crate) fn create_stream_sink(
        &self,
        stream_id: &str,
    ) -> Result<Arc<dyn DeviceLogBatchSink>, String> {
        create_stream_sink(self.stats.clone(), stream_id)
    }

    pub(crate) fn stats_state(&self) -> Arc<DeviceLogRuntimeState> {
        self.stats.clone()
    }

    pub(crate) fn insert_stream(&self, stream_id: String, child: Child) -> Arc<Mutex<Child>> {
        let child = Arc::new(Mutex::new(child));
        self.streams
            .lock()
            .expect("device log stream lock")
            .insert(stream_id, child.clone());
        child
    }

    pub(crate) fn remove_stream(&self, stream_id: &str) -> Option<Arc<Mutex<Child>>> {
        self.streams
            .lock()
            .expect("device log stream lock")
            .remove(stream_id)
    }
}
