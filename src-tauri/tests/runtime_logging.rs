use arkline_lib::runtime_logging::{runtime_log_policy, RuntimeLogRotation};

#[test]
fn packaged_runtime_logs_are_file_backed_and_bounded() {
    let policy = runtime_log_policy();

    assert_eq!(policy.file_name, "ArkLine");
    assert_eq!(policy.max_file_size_bytes, 10 * 1024 * 1024);
    assert_eq!(policy.rotation, RuntimeLogRotation::KeepOne);
    assert!(policy.log_to_os_app_log_dir);
    assert!(policy.log_to_stderr);
}
