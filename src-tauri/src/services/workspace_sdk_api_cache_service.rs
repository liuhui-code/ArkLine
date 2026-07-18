#![allow(dead_code)]

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::time::UNIX_EPOCH;

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

pub fn sdk_api_file_manifest_fingerprint(files: &[String]) -> Result<String, String> {
    let mut sorted = files.to_vec();
    sorted.sort();
    let mut hasher = DefaultHasher::new();
    for file in sorted {
        let metadata = fs::metadata(&file).map_err(|error| error.to_string())?;
        file.replace('\\', "/").hash(&mut hasher);
        metadata.len().hash(&mut hasher);
        metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
            .hash(&mut hasher);
    }
    Ok(format!("{:016x}", hasher.finish()))
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
