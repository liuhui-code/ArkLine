use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_sdk_api_cache_service::{
    sdk_api_cache_key, sdk_api_file_manifest_fingerprint, sdk_api_manifest_fingerprint,
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
fn sdk_file_manifest_fingerprint_changes_when_file_metadata_changes() {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("arkline-sdk-manifest-{suffix}"));
    fs::create_dir_all(&root).unwrap();
    let first = root.join("a.d.ts");
    let second = root.join("b.d.ts");
    fs::write(&first, "declare class A {}\n").unwrap();
    fs::write(&second, "declare class B {}\n").unwrap();
    let files = vec![
        first.to_string_lossy().to_string(),
        second.to_string_lossy().to_string(),
    ];
    let before = sdk_api_file_manifest_fingerprint(&files).unwrap();
    fs::write(&second, "declare class BiggerB { value: number }\n").unwrap();
    let after = sdk_api_file_manifest_fingerprint(&files).unwrap();

    assert_ne!(before, after);
    assert_eq!(
        after,
        sdk_api_file_manifest_fingerprint(&[files[1].clone(), files[0].clone()]).unwrap()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn sdk_api_manifest_fingerprint_is_order_independent() {
    let first = sdk_api_manifest_fingerprint(&["b.d.ts".to_string(), "a.d.ts".to_string()]);
    let second = sdk_api_manifest_fingerprint(&["a.d.ts".to_string(), "b.d.ts".to_string()]);

    assert_eq!(first, second);
}
