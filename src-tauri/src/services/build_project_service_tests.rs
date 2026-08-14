use std::fs;
use std::path::PathBuf;

use super::{find_harmony_build_artifacts, inspect_harmony_build_project};

#[test]
fn detects_root_markers_and_modules_without_a_workspace_scan() {
    let root = std::env::temp_dir().join(format!("arkline-build-project-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("entry/src/main/ets")).unwrap();
    fs::write(root.join("hvigorw"), "#!/bin/sh").unwrap();
    fs::write(root.join("hvigorfile.ts"), "export {}").unwrap();
    fs::write(root.join("build-profile.json5"), "{}").unwrap();

    let project = inspect_harmony_build_project(root.to_str().unwrap()).unwrap();

    assert!(project.is_harmony_project);
    assert_eq!(project.hvigor_wrapper_command.as_deref(), Some("./hvigorw"));
    assert_eq!(project.modules, vec!["entry"]);
    assert_eq!(project.default_module.as_deref(), Some("entry"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn verifies_a_generated_hap_from_the_expected_module_output_tree() {
    let root = std::env::temp_dir().join(format!("arkline-build-artifact-{}", std::process::id()));
    let artifact = root.join("entry/build/default/outputs/default/entry-default-unsigned.hap");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(artifact.parent().unwrap()).unwrap();
    fs::write(&artifact, "hap").unwrap();

    let artifacts =
        find_harmony_build_artifacts(root.to_str().unwrap(), "hap", Some("entry"), "default")
            .unwrap();

    assert_eq!(artifacts, vec![artifact.to_string_lossy().to_string()]);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn resolves_project_root_from_a_selected_module_directory() {
    let repo = std::env::temp_dir().join(format!(
        "arkline-build-project-nested-{}",
        std::process::id()
    ));
    let root = repo.join("apps/Demo");
    let selected = root.join("entry/src/main/ets");
    let _ = fs::remove_dir_all(&repo);
    fs::create_dir_all(&selected).unwrap();
    fs::write(root.join("hvigorw"), "#!/bin/sh").unwrap();
    fs::write(root.join("hvigorfile.ts"), "export {}").unwrap();
    fs::write(root.join("build-profile.json5"), "{}").unwrap();

    let project = inspect_harmony_build_project(selected.to_str().unwrap()).unwrap();

    assert_eq!(project.root_path, root.to_string_lossy());
    assert!(project.is_harmony_project);
    assert_eq!(project.modules, vec!["entry"]);
    fs::remove_dir_all(repo).unwrap();
}

#[test]
fn prefers_the_wrapper_root_over_a_module_package_marker() {
    let repo = std::env::temp_dir().join(format!(
        "arkline-build-project-module-package-{}",
        std::process::id()
    ));
    let root = repo.join("apps/Demo");
    let file = root.join("entry/src/main/ets/Index.ets");
    let _ = fs::remove_dir_all(&repo);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, "@Entry struct Index {}").unwrap();
    fs::write(root.join("hvigorw"), "#!/bin/sh").unwrap();
    fs::write(root.join("hvigorfile.ts"), "export {}").unwrap();
    fs::write(root.join("build-profile.json5"), "{}").unwrap();
    fs::write(root.join("entry/oh-package.json5"), "{}").unwrap();

    let project = inspect_harmony_build_project(file.to_str().unwrap()).unwrap();

    assert_eq!(project.root_path, root.to_string_lossy());
    assert!(project.has_hvigor_wrapper);
    assert_eq!(project.modules, vec!["entry"]);
    fs::remove_dir_all(repo).unwrap();
}

#[test]
fn inspects_a_realistic_deveco_project_from_a_module_source_file() {
    let root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/services/fixtures/harmony-project");
    let file = root.join("entry/src/main/ets/Index.ets");

    let project = inspect_harmony_build_project(file.to_str().unwrap()).unwrap();

    assert_eq!(project.root_path, root.to_string_lossy());
    assert_eq!(project.modules, vec!["entry"]);
    assert_eq!(project.default_module.as_deref(), Some("entry"));
    assert_eq!(project.products, vec!["china", "default"]);
    assert_eq!(project.default_product.as_deref(), Some("default"));
    assert!(project.has_hvigor_wrapper);
    assert!(project.product_signing.iter().all(|signing| !signing.ready));
    assert!(project
        .product_signing
        .iter()
        .all(|signing| { signing.issues == ["product does not reference signingConfig"] }));
}

#[test]
fn resolves_project_root_from_an_active_file() {
    let repo =
        std::env::temp_dir().join(format!("arkline-build-project-file-{}", std::process::id()));
    let root = repo.join("apps/Demo");
    let file = root.join("entry/src/main/ets/Index.ets");
    let _ = fs::remove_dir_all(&repo);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, "@Entry struct Index {}").unwrap();
    fs::write(root.join("hvigorw.bat"), "").unwrap();
    fs::write(root.join("oh-package.json5"), "{}").unwrap();

    let project = inspect_harmony_build_project(file.to_str().unwrap()).unwrap();

    assert_eq!(project.root_path, root.to_string_lossy());
    assert_eq!(
        project.hvigor_wrapper_command.as_deref(),
        Some("hvigorw.bat")
    );
    assert_eq!(project.default_module.as_deref(), Some("entry"));
    fs::remove_dir_all(repo).unwrap();
}

#[test]
fn merges_modules_declared_by_build_profile() {
    let root = std::env::temp_dir().join(format!(
        "arkline-build-project-profile-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("feature")).unwrap();
    fs::write(root.join("hvigorw"), "#!/bin/sh").unwrap();
    fs::write(root.join("hvigorfile.ts"), "export {}").unwrap();
    fs::write(
        root.join("build-profile.json5"),
        "{ products: [{ name: 'china', compileSdkVersion: 25 }, { name: 'default', compileSdkVersion: '26.0.0' }], modules: [{ name: 'feature' }] }",
    )
    .unwrap();

    let project = inspect_harmony_build_project(root.to_str().unwrap()).unwrap();

    assert_eq!(project.modules, vec!["feature"]);
    assert_eq!(project.products, vec!["china", "default"]);
    assert_eq!(project.default_product.as_deref(), Some("default"));
    assert_eq!(project.product_sdks[0].product, "china");
    assert_eq!(
        project.product_sdks[0].compile_sdk_version.as_deref(),
        Some("25")
    );
    assert_eq!(
        project.product_sdks[1].compile_sdk_version.as_deref(),
        Some("26.0.0")
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_complete_signing_without_exposing_material_values() {
    let root = std::env::temp_dir().join(format!(
        "arkline-build-project-signing-ready-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("entry/src/main")).unwrap();
    fs::create_dir_all(root.join("SigningConfig")).unwrap();
    for file in ["debug.cer", "debug.p7b", "debug.p12"] {
        fs::write(root.join("SigningConfig").join(file), "material").unwrap();
    }
    fs::write(root.join("hvigorfile.ts"), "export {}").unwrap();
    fs::write(
        root.join("build-profile.json5"),
        r#"{
          app: {
            signingConfigs: [{
              name: 'default', type: 'HarmonyOS', material: {
                certpath: './SigningConfig/debug.cer', profile: './SigningConfig/debug.p7b',
                storeFile: './SigningConfig/debug.p12', storePassword: 'encrypted-secret',
                keyAlias: 'debugKey', keyPassword: 'encrypted-secret', signAlg: 'SHA256withECDSA'
              }
            }],
            products: [{ name: 'default', signingConfig: 'default' }]
          },
          modules: [{ name: 'entry' }]
        }"#,
    )
    .unwrap();

    let project = inspect_harmony_build_project(root.to_str().unwrap()).unwrap();

    assert_eq!(project.product_signing.len(), 1);
    assert!(project.product_signing[0].ready);
    assert!(project.product_signing[0].issues.is_empty());
    let serialized = serde_json::to_string(&project).unwrap();
    assert!(!serialized.contains("encrypted-secret"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_missing_signing_config_and_material_files() {
    let root = std::env::temp_dir().join(format!(
        "arkline-build-project-signing-missing-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("entry/src/main")).unwrap();
    fs::write(root.join("hvigorfile.ts"), "export {}").unwrap();
    fs::write(
        root.join("build-profile.json5"),
        r#"{
          app: {
            signingConfigs: [{ name: 'partial', type: 'HarmonyOS', material: {
              certpath: './missing.cer', profile: './missing.p7b', storeFile: './missing.p12'
            }}],
            products: [
              { name: 'default', signingConfig: 'missing' },
              { name: 'partial', signingConfig: 'partial' }
            ]
          },
          modules: [{ name: 'entry' }]
        }"#,
    )
    .unwrap();

    let project = inspect_harmony_build_project(root.to_str().unwrap()).unwrap();

    assert_eq!(project.product_signing[0].product, "default");
    assert!(!project.product_signing[0].ready);
    assert_eq!(
        project.product_signing[0].issues,
        vec!["signingConfigs does not define 'missing'"]
    );
    assert!(!project.product_signing[1].ready);
    assert!(project.product_signing[1]
        .issues
        .contains(&"material.storePassword is missing".to_string()));
    assert!(project.product_signing[1]
        .issues
        .contains(&"material.storeFile file does not exist".to_string()));
    fs::remove_dir_all(root).unwrap();
}
