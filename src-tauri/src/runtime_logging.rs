use log::LevelFilter;
use tauri::{plugin::TauriPlugin, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

const APP_LOG_TARGET: &str = "arkline::app";
const DISCOVERY_LOG_TARGET: &str = "arkline::discovery";
const INDEXER_LOG_TARGET: &str = "arkline::indexer";
const MAX_INDEXER_STDERR_CHARS: usize = 4_096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeLogRotation {
    KeepOne,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimeLogPolicy {
    pub file_name: &'static str,
    pub max_file_size_bytes: u128,
    pub rotation: RuntimeLogRotation,
    pub log_to_os_app_log_dir: bool,
    pub log_to_stderr: bool,
}

pub const fn runtime_log_policy() -> RuntimeLogPolicy {
    RuntimeLogPolicy {
        file_name: "ArkLine",
        max_file_size_bytes: 10 * 1024 * 1024,
        rotation: RuntimeLogRotation::KeepOne,
        log_to_os_app_log_dir: true,
        log_to_stderr: true,
    }
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let policy = runtime_log_policy();
    tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::LogDir {
                file_name: Some(policy.file_name.to_string()),
            }),
            Target::new(TargetKind::Stderr),
        ])
        .level(LevelFilter::Info)
        .max_file_size(policy.max_file_size_bytes)
        .rotation_strategy(RotationStrategy::KeepOne)
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build()
}

pub fn log_app_started() {
    log::info!(
        target: APP_LOG_TARGET,
        "event=app_started version={} platform={}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS
    );
}

pub fn log_discovery_chunk_started(
    root_path: &str,
    generation: u64,
    pending_directory_count: usize,
    limit: usize,
) {
    log::info!(
        target: DISCOVERY_LOG_TARGET,
        "event=discovery_chunk_started root={root_path:?} generation={generation} pending_directories={pending_directory_count} limit={limit}"
    );
}

pub fn log_discovery_chunk_completed(
    root_path: &str,
    generation: u64,
    provider: &str,
    scanned_file_count: usize,
    excluded_count: usize,
    has_more: bool,
) {
    log::info!(
        target: DISCOVERY_LOG_TARGET,
        "event=discovery_chunk_completed root={root_path:?} generation={generation} provider={provider} scanned_files={scanned_file_count} excluded_entries={excluded_count} has_more={has_more}"
    );
}

pub fn log_discovery_fallback(root_path: &str, generation: u64, reason: &str) {
    log::warn!(
        target: DISCOVERY_LOG_TARGET,
        "event=discovery_fallback root={root_path:?} generation={generation} reason={reason:?}"
    );
}

pub fn log_discovery_failed(root_path: &str, generation: u64, provider: &str, error: &str) {
    log::error!(
        target: DISCOVERY_LOG_TARGET,
        "event=discovery_chunk_failed root={root_path:?} generation={generation} provider={provider} error={error:?}"
    );
}

pub fn log_indexer_stderr(line: &str) {
    let line = bounded_single_line(line, MAX_INDEXER_STDERR_CHARS);
    if line.is_empty() {
        return;
    }
    log::warn!(target: INDEXER_LOG_TARGET, "event=indexer_stderr message={line:?}");
}

fn bounded_single_line(value: &str, max_chars: usize) -> String {
    value
        .trim()
        .chars()
        .take(max_chars)
        .map(|character| match character {
            '\r' | '\n' => ' ',
            value => value,
        })
        .collect()
}
