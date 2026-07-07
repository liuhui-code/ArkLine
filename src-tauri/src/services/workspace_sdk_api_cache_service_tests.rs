use crate::services::workspace_sdk_api_cache_service::{
    sdk_api_cache_key, sdk_api_manifest_fingerprint,
};

#[test]
fn sdk_api_cache_key_changes_when_sdk_version_or_manifest_changes() {
    let first = sdk_api_cache_key("/sdk", "5.0.0", "parser-v1", "manifest-a");
    let second = sdk_api_cache_key("/sdk", "5.0.1", "parser-v1", "manifest-a");
    let third = sdk_api_cache_key("/sdk", "5.0.0", "parser-v1", "manifest-b");

    assert_ne!(first, second);
    assert_ne!(first, third);
}

#[test]
fn sdk_api_manifest_fingerprint_is_order_independent() {
    let first = sdk_api_manifest_fingerprint(&["b.d.ts".to_string(), "a.d.ts".to_string()]);
    let second = sdk_api_manifest_fingerprint(&["a.d.ts".to_string(), "b.d.ts".to_string()]);

    assert_eq!(first, second);
}
