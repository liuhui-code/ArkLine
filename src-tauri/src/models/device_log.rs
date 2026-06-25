use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogDevice {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartDeviceLogStreamRequest {
    pub device_id: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListDeviceFaultLogsRequest {
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogStreamSummary {
    pub stream_id: String,
    pub device_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogOutputBatch {
    pub stream_id: String,
    pub device_id: String,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFaultLogRawEntry {
    pub id: String,
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFaultLogFetchResult {
    pub device_id: String,
    pub fetched_at: String,
    pub entries: Vec<DeviceFaultLogRawEntry>,
    pub command: String,
    pub stderr: String,
    pub status: String,
    pub message: String,
}
