use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::{
    deveco_hvigor_candidates, resolve_build_environment, resolve_build_environment_from_candidates,
    resolve_hvigor_from_candidates, resolve_node_path,
};
use crate::models::build_environment::BuildEnvironmentRequest;

fn temporary_root() -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-build-environment-{suffix}"))
}

#[test]
fn resolves_configured_node_and_sdk_into_one_build_environment() {
    let root = temporary_root();
    let node_home = root.join("node-home");
    let node = node_home.join("bin/node");
    let sdk = root.join("sdk");
    fs::create_dir_all(node.parent().unwrap()).unwrap();
    fs::create_dir_all(sdk.join("ets")).unwrap();
    fs::create_dir_all(sdk.join("toolchains")).unwrap();
    fs::write(
        sdk.join("toolchains/oh-uni-package.json"),
        r#"{"apiVersion":"24","version":"6.1.1.125"}"#,
    )
    .unwrap();
    fs::write(&node, "node").unwrap();
    let wrapper = root.join("hvigorw");
    fs::write(&wrapper, "#!/bin/sh").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&wrapper).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&wrapper, permissions).unwrap();
    }

    let resolution = resolve_build_environment(&BuildEnvironmentRequest {
        root_path: root.to_string_lossy().to_string(),
        harmony_sdk_path: sdk.to_string_lossy().to_string(),
        node_path: node_home.to_string_lossy().to_string(),
        auto_detect: false,
    });

    assert!(resolution.can_build);
    assert_eq!(
        resolution.node_path,
        Some(node_home.join("bin").to_string_lossy().to_string())
    );
    assert_eq!(resolution.sdk_path, Some(sdk.to_string_lossy().to_string()));
    assert_eq!(resolution.sdk_api_version.as_deref(), Some("24"));
    assert_eq!(
        resolution.path_entries[0],
        node_home.join("bin").to_string_lossy()
    );
    assert_eq!(
        resolution.environment["HOS_SDK_HOME"],
        sdk.to_string_lossy()
    );
    assert_eq!(
        resolution.environment["NODE_HOME"],
        node_home.to_string_lossy()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn explains_a_missing_wrapper_at_the_canonical_project_root() {
    let root = temporary_root();
    let node = root.join("node");
    let sdk = root.join("sdk");
    fs::create_dir_all(sdk.join("ets")).unwrap();
    fs::create_dir_all(sdk.join("toolchains")).unwrap();
    fs::write(
        sdk.join("toolchains/oh-uni-package.json"),
        r#"{"apiVersion":24,"version":"6.1.1.125"}"#,
    )
    .unwrap();
    fs::write(&node, "node").unwrap();
    fs::write(root.join("hvigorfile.ts"), "export {}").unwrap();
    fs::write(root.join("build-profile.json5"), "{}").unwrap();

    let resolution = resolve_build_environment(&BuildEnvironmentRequest {
        root_path: root.to_string_lossy().to_string(),
        harmony_sdk_path: sdk.to_string_lossy().to_string(),
        node_path: node.to_string_lossy().to_string(),
        auto_detect: false,
    });

    let hvigor = resolution
        .checks
        .iter()
        .find(|check| check.name == "hvigor")
        .unwrap();
    assert!(!hvigor.available);
    assert!(hvigor.detail.contains("canonical project root"));
    assert!(hvigor.detail.contains(root.to_string_lossy().as_ref()));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn falls_back_to_deveco_hvigor_and_its_bundled_node() {
    let contents = temporary_root().join("DevEco-Studio.app/Contents");
    let project = contents.join("workspace");
    let hvigor = contents.join("tools/hvigor/bin/hvigorw");
    let node = contents.join("tools/node/bin/node");
    fs::create_dir_all(&project).unwrap();
    fs::create_dir_all(hvigor.parent().unwrap()).unwrap();
    fs::create_dir_all(node.parent().unwrap()).unwrap();
    fs::write(&hvigor, "#!/bin/sh").unwrap();
    fs::write(&node, "node").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&hvigor).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&hvigor, permissions).unwrap();
    }
    let request = BuildEnvironmentRequest {
        root_path: project.to_string_lossy().to_string(),
        harmony_sdk_path: String::new(),
        node_path: String::new(),
        auto_detect: true,
    };

    let resolved = resolve_hvigor_from_candidates(&request, vec![hvigor.clone()]).unwrap();
    let resolved_node = resolve_node_path(&request, Some(&resolved)).unwrap();

    assert_eq!(resolved.source, "deveco");
    assert_eq!(resolved.command, hvigor);
    assert_eq!(resolved_node.bin_dir, contents.join("tools/node/bin"));
    assert_eq!(resolved_node.home, Some(contents.join("tools/node")));
    fs::remove_dir_all(contents.parent().unwrap().parent().unwrap()).unwrap();
}

#[test]
fn includes_windows_deveco_hvigor_candidates_from_standard_roots() {
    let program_files = PathBuf::from(r"C:\Program Files");
    let local_app_data = PathBuf::from(r"C:\Users\demo\AppData\Local");

    let candidates = deveco_hvigor_candidates(
        "windows",
        vec![program_files.clone()],
        Some(local_app_data.clone()),
    );

    assert!(candidates
        .contains(&program_files.join("Huawei/DevEco Studio/tools/hvigor/bin/hvigorw.bat")));
    assert!(candidates
        .contains(&local_app_data.join("Programs/DevEco Studio/tools/hvigor/bin/hvigorw.bat")));
}

#[test]
fn resolves_windows_deveco_hvigor_node_and_sdk_from_one_installation() {
    let root = temporary_root();
    let install = root.join("Huawei/DevEco Studio");
    let project = root.join("workspace");
    let hvigor = install.join("tools/hvigor/bin/hvigorw.bat");
    let node_home = install.join("tools/node");
    let node = node_home.join("node.exe");
    let sdk = install.join("sdk/default/openharmony");
    fs::create_dir_all(&project).unwrap();
    fs::create_dir_all(hvigor.parent().unwrap()).unwrap();
    fs::create_dir_all(&node_home).unwrap();
    fs::create_dir_all(sdk.join("ets")).unwrap();
    fs::create_dir_all(sdk.join("toolchains")).unwrap();
    fs::write(
        sdk.join("toolchains/oh-uni-package.json"),
        r#"{"apiVersion":24,"version":"6.1.1.125"}"#,
    )
    .unwrap();
    fs::write(&hvigor, "@echo off").unwrap();
    fs::write(&node, "node").unwrap();
    let request = BuildEnvironmentRequest {
        root_path: project.to_string_lossy().to_string(),
        harmony_sdk_path: String::new(),
        node_path: String::new(),
        auto_detect: true,
    };

    let resolution = resolve_build_environment_from_candidates(&request, vec![hvigor.clone()]);

    assert!(resolution.can_build);
    assert_eq!(
        resolution.hvigor_command,
        Some(hvigor.to_string_lossy().to_string())
    );
    assert_eq!(
        resolution.node_path,
        Some(node_home.to_string_lossy().to_string())
    );
    assert_eq!(resolution.sdk_path, Some(sdk.to_string_lossy().to_string()));
    assert_eq!(resolution.sdk_api_version.as_deref(), Some("24"));
    assert_eq!(
        resolution.environment["NODE_HOME"],
        node_home.to_string_lossy()
    );
    assert_eq!(
        resolution.environment["DEVECO_SDK_HOME"],
        install.join("sdk").to_string_lossy()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn requires_ohpm_only_when_declared_dependencies_are_not_installed() {
    let root = temporary_root();
    let node_home = root.join("node-home");
    let sdk = root.join("sdk");
    fs::create_dir_all(node_home.join("bin")).unwrap();
    fs::create_dir_all(sdk.join("ets")).unwrap();
    fs::create_dir_all(sdk.join("toolchains")).unwrap();
    fs::write(node_home.join("bin/node"), "node").unwrap();
    fs::write(root.join("hvigorw"), "#!/bin/sh").unwrap();
    fs::write(
        root.join("oh-package.json5"),
        r#"{ "dependencies": { "@ohos/example": "1.0.0" } }"#,
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(root.join("hvigorw")).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(root.join("hvigorw"), permissions).unwrap();
    }

    let request = BuildEnvironmentRequest {
        root_path: root.to_string_lossy().to_string(),
        harmony_sdk_path: sdk.to_string_lossy().to_string(),
        node_path: node_home.to_string_lossy().to_string(),
        auto_detect: false,
    };
    let missing = resolve_build_environment_from_candidates(&request, Vec::new());

    assert!(missing.dependency_restore_required);
    assert!(!missing.can_build);
    assert_eq!(missing.ohpm_command, None);
    assert!(missing
        .checks
        .iter()
        .any(|check| check.name == "ohpm" && !check.available));

    fs::create_dir_all(root.join("oh_modules")).unwrap();
    let installed = resolve_build_environment_from_candidates(&request, Vec::new());

    assert!(!installed.dependency_restore_required);
    assert!(installed.can_build);
    assert!(installed
        .checks
        .iter()
        .any(|check| check.name == "ohpm" && check.available));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn detects_deveco_ohpm_for_missing_module_dependencies() {
    let root = temporary_root();
    let install = root.join("DevEco-Studio.app/Contents");
    let project = root.join("workspace");
    let hvigor = install.join("tools/hvigor/bin/hvigorw");
    let ohpm = install.join("tools/ohpm/bin/ohpm");
    let node = install.join("tools/node/bin/node");
    let sdk = install.join("sdk/default/openharmony");
    fs::create_dir_all(project.join("entry/src/main")).unwrap();
    fs::create_dir_all(hvigor.parent().unwrap()).unwrap();
    fs::create_dir_all(ohpm.parent().unwrap()).unwrap();
    fs::create_dir_all(node.parent().unwrap()).unwrap();
    fs::create_dir_all(sdk.join("ets")).unwrap();
    fs::create_dir_all(sdk.join("toolchains")).unwrap();
    fs::write(&hvigor, "#!/bin/sh").unwrap();
    fs::write(&ohpm, "#!/bin/sh").unwrap();
    fs::write(&node, "node").unwrap();
    fs::write(
        project.join("entry/oh-package.json5"),
        r#"{ "devDependencies": { /* test dependency */ "@ohos/hypium": "1.0.0" } }"#,
    )
    .unwrap();
    #[cfg(unix)]
    for command in [&hvigor, &ohpm] {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(command).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(command, permissions).unwrap();
    }

    let resolution = resolve_build_environment_from_candidates(
        &BuildEnvironmentRequest {
            root_path: project.to_string_lossy().to_string(),
            harmony_sdk_path: String::new(),
            node_path: String::new(),
            auto_detect: true,
        },
        vec![hvigor],
    );

    assert!(resolution.can_build);
    assert!(resolution.dependency_restore_required);
    assert_eq!(
        resolution.ohpm_command,
        Some(ohpm.to_string_lossy().to_string())
    );
    fs::remove_dir_all(root).unwrap();
}
