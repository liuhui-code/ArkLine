#![allow(dead_code)]

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub const SDK_API_PARSER_VERSION: &str = "sdk-api-parser-v1";

pub fn sdk_api_manifest_fingerprint(files: &[String]) -> String {
    let mut sorted = files.to_vec();
    sorted.sort();
    let mut hasher = DefaultHasher::new();
    for file in sorted {
        file.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

pub fn sdk_api_cache_key(
    sdk_path: &str,
    sdk_version: &str,
    parser_version: &str,
    manifest_fingerprint: &str,
) -> String {
    let mut hasher = DefaultHasher::new();
    sdk_path.replace('\\', "/").hash(&mut hasher);
    sdk_version.hash(&mut hasher);
    parser_version.hash(&mut hasher);
    manifest_fingerprint.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}
