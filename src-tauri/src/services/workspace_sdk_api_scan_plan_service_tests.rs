use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_sdk_api_scan_plan_service::{
    plan_sdk_api_scan, sdk_api_scan_chunks,
};

#[test]
fn selects_declaration_and_api_source_files_but_excludes_noise() {
    let root = temp_dir("sdk-api-scan");
    write(
        &root,
        "ets/component/common.d.ts",
        "export interface Button {}",
    );
    write(&root, "ets/api/arkui.ts", "export class Text {}");
    write(&root, "samples/demo/index.ets", "export class Sample {}");
    write(&root, "docs/api.md", "# docs");
    write(
        &root,
        "build/generated.d.ts",
        "export interface Generated {}",
    );

    let plan = plan_sdk_api_scan(&root.to_string_lossy()).unwrap();

    assert_eq!(
        relative_paths(&root, &plan.files),
        vec!["ets/api/arkui.ts", "ets/component/common.d.ts"]
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn chunks_sdk_api_files_deterministically() {
    let files = vec![
        "c.d.ts".to_string(),
        "a.d.ts".to_string(),
        "b.d.ts".to_string(),
    ];

    let chunks = sdk_api_scan_chunks(files, 2);

    assert_eq!(
        chunks,
        vec![
            vec!["a.d.ts".to_string(), "b.d.ts".to_string()],
            vec!["c.d.ts".to_string()]
        ]
    );
}

fn temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

fn write(root: &Path, relative: &str, content: &str) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn relative_paths(root: &Path, files: &[String]) -> Vec<String> {
    files
        .iter()
        .map(|path| {
            Path::new(path)
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect()
}
