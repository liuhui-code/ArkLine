use crate::services::device_log_query_generation_service::DeviceLogQueryGenerationRegistry;

#[test]
fn newer_query_token_cancels_older_token_for_same_stream() {
    let registry = DeviceLogQueryGenerationRegistry::default();

    let first = registry.begin("stream-1");
    let second = registry.begin("stream-1");

    assert!(first.cancelled());
    assert!(!second.cancelled());
}

#[test]
fn query_tokens_are_isolated_by_stream() {
    let registry = DeviceLogQueryGenerationRegistry::default();

    let first_stream = registry.begin("stream-1");
    let second_stream = registry.begin("stream-2");

    assert!(!first_stream.cancelled());
    assert!(!second_stream.cancelled());
}
