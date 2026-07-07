use crate::services::workspace_performance_config_service::{
    resolve_performance_config, BackgroundIndexingMode, PerformanceProfile, PerformanceUserSettings,
};

#[test]
fn balanced_profile_uses_safe_default_budgets() {
    let config = resolve_performance_config(&PerformanceUserSettings {
        profile: Some(PerformanceProfile::Balanced),
        cpu_count: Some(8),
        ..PerformanceUserSettings::default()
    });

    assert_eq!(config.profile, PerformanceProfile::Balanced);
    assert_eq!(config.parser_workers, 4);
    assert_eq!(config.writer_batch_files, 128);
    assert_eq!(config.index_hot_cache_mb, 512);
    assert_eq!(config.background_indexing, BackgroundIndexingMode::Balanced);
    assert!(config.foreground_task_reserve);
    assert!(config.warnings.is_empty());
}

#[test]
fn large_project_profile_allows_more_cache_and_workers() {
    let config = resolve_performance_config(&PerformanceUserSettings {
        profile: Some(PerformanceProfile::LargeProject),
        cpu_count: Some(16),
        ..PerformanceUserSettings::default()
    });

    assert_eq!(config.profile, PerformanceProfile::LargeProject);
    assert_eq!(config.parser_workers, 6);
    assert_eq!(config.writer_batch_files, 256);
    assert_eq!(config.index_hot_cache_mb, 1024);
    assert_eq!(config.search_result_cache_mb, 256);
}

#[test]
fn low_memory_profile_caps_workers_and_cache() {
    let config = resolve_performance_config(&PerformanceUserSettings {
        profile: Some(PerformanceProfile::LowMemory),
        cpu_count: Some(12),
        ..PerformanceUserSettings::default()
    });

    assert_eq!(config.profile, PerformanceProfile::LowMemory);
    assert_eq!(config.parser_workers, 2);
    assert_eq!(config.writer_batch_files, 64);
    assert_eq!(config.index_hot_cache_mb, 128);
    assert_eq!(config.opened_document_cache_mb, 64);
}

#[test]
fn custom_profile_clamps_unsafe_values_and_reports_warnings() {
    let config = resolve_performance_config(&PerformanceUserSettings {
        profile: Some(PerformanceProfile::Custom),
        cpu_count: Some(32),
        parser_workers: Some(24),
        index_hot_cache_mb: Some(16),
        search_result_cache_mb: Some(4096),
        opened_document_cache_mb: Some(8),
        writer_batch_files: Some(4096),
        writer_batch_ms: Some(5),
        ..PerformanceUserSettings::default()
    });

    assert_eq!(config.profile, PerformanceProfile::Custom);
    assert_eq!(config.parser_workers, 8);
    assert_eq!(config.index_hot_cache_mb, 64);
    assert_eq!(config.search_result_cache_mb, 2048);
    assert_eq!(config.opened_document_cache_mb, 32);
    assert_eq!(config.writer_batch_files, 512);
    assert_eq!(config.writer_batch_ms, 25);
    assert!(config.warnings.len() >= 5);
}

#[test]
fn missing_profile_falls_back_to_balanced() {
    let config = resolve_performance_config(&PerformanceUserSettings {
        profile: None,
        cpu_count: Some(1),
        ..PerformanceUserSettings::default()
    });

    assert_eq!(config.profile, PerformanceProfile::Balanced);
    assert_eq!(config.parser_workers, 1);
    assert!(config
        .warnings
        .iter()
        .any(|warning| warning.code == "profile.defaulted"));
}
