mod protocol;
mod request_validation;
#[cfg(test)]
mod request_validation_tests;
mod stdio;
#[cfg(test)]
mod stdio_prepare_tests;

pub use protocol::{
    IndexerContentRefreshRequest, IndexerContentRefreshResult, IndexerDiscoveryRequest,
    IndexerDiscoveryResult, IndexerRequest, IndexerResponse, IndexerStubRefreshRequest,
    IndexerStubRefreshResult, IndexerTaskKey, INDEXER_CONTENT_REFRESH_PATH_LIMIT,
    INDEXER_PROTOCOL_VERSION, INDEXER_STUB_REFRESH_PATH_LIMIT,
};

pub fn run_stdio() -> Result<(), String> {
    stdio::run_stream(std::io::stdin().lock(), std::io::stdout().lock())
}
