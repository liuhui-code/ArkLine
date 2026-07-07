#![allow(dead_code)]

use std::thread;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PerformanceProfile {
    Balanced,
    LargeProject,
    LowMemory,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackgroundIndexingMode {
    Conservative,
    Balanced,
    Aggressive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PerformanceUserSettings {
    pub profile: Option<PerformanceProfile>,
    pub cpu_count: Option<usize>,
    pub parser_workers: Option<usize>,
    pub background_indexing: Option<BackgroundIndexingMode>,
    pub foreground_task_reserve: Option<bool>,
    pub index_hot_cache_mb: Option<usize>,
    pub search_result_cache_mb: Option<usize>,
    pub opened_document_cache_mb: Option<usize>,
    pub writer_batch_files: Option<usize>,
    pub writer_batch_ms: Option<u64>,
    pub auto_large_project_mode: Option<bool>,
}

impl Default for PerformanceUserSettings {
    fn default() -> Self {
        Self {
            profile: Some(PerformanceProfile::Balanced),
            cpu_count: None,
            parser_workers: None,
            background_indexing: None,
            foreground_task_reserve: None,
            index_hot_cache_mb: None,
            search_result_cache_mb: None,
            opened_document_cache_mb: None,
            writer_batch_files: None,
            writer_batch_ms: None,
            auto_large_project_mode: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectivePerformanceConfig {
    pub profile: PerformanceProfile,
    pub parser_workers: usize,
    pub background_indexing: BackgroundIndexingMode,
    pub foreground_task_reserve: bool,
    pub index_hot_cache_mb: usize,
    pub search_result_cache_mb: usize,
    pub opened_document_cache_mb: usize,
    pub writer_batch_files: usize,
    pub writer_batch_ms: u64,
    pub auto_large_project_mode: bool,
    pub warnings: Vec<PerformanceConfigWarning>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PerformanceConfigWarning {
    pub code: String,
    pub message: String,
}

pub fn resolve_performance_config(
    settings: &PerformanceUserSettings,
) -> EffectivePerformanceConfig {
    let mut warnings = Vec::new();
    let profile = settings.profile.unwrap_or_else(|| {
        warnings.push(warning(
            "profile.defaulted",
            "Performance profile was missing; Balanced was used.",
        ));
        PerformanceProfile::Balanced
    });
    let defaults = profile_defaults(profile, cpu_count(settings));

    EffectivePerformanceConfig {
        profile,
        parser_workers: clamp_usize(
            "parserWorkers",
            settings.parser_workers.unwrap_or(defaults.parser_workers),
            1,
            8,
            &mut warnings,
        ),
        background_indexing: settings
            .background_indexing
            .unwrap_or(defaults.background_indexing),
        foreground_task_reserve: settings
            .foreground_task_reserve
            .unwrap_or(defaults.foreground_task_reserve),
        index_hot_cache_mb: clamp_usize(
            "indexHotCacheMb",
            settings
                .index_hot_cache_mb
                .unwrap_or(defaults.index_hot_cache_mb),
            64,
            4096,
            &mut warnings,
        ),
        search_result_cache_mb: clamp_usize(
            "searchResultCacheMb",
            settings
                .search_result_cache_mb
                .unwrap_or(defaults.search_result_cache_mb),
            32,
            2048,
            &mut warnings,
        ),
        opened_document_cache_mb: clamp_usize(
            "openedDocumentCacheMb",
            settings
                .opened_document_cache_mb
                .unwrap_or(defaults.opened_document_cache_mb),
            32,
            1024,
            &mut warnings,
        ),
        writer_batch_files: clamp_usize(
            "writerBatchFiles",
            settings
                .writer_batch_files
                .unwrap_or(defaults.writer_batch_files),
            16,
            512,
            &mut warnings,
        ),
        writer_batch_ms: clamp_u64(
            "writerBatchMs",
            settings.writer_batch_ms.unwrap_or(defaults.writer_batch_ms),
            25,
            1000,
            &mut warnings,
        ),
        auto_large_project_mode: settings
            .auto_large_project_mode
            .unwrap_or(defaults.auto_large_project_mode),
        warnings,
    }
}

fn profile_defaults(profile: PerformanceProfile, cpu_count: usize) -> EffectivePerformanceConfig {
    match profile {
        PerformanceProfile::Balanced | PerformanceProfile::Custom => EffectivePerformanceConfig {
            profile,
            parser_workers: auto_workers(cpu_count, 4),
            background_indexing: BackgroundIndexingMode::Balanced,
            foreground_task_reserve: true,
            index_hot_cache_mb: 512,
            search_result_cache_mb: 128,
            opened_document_cache_mb: 128,
            writer_batch_files: 128,
            writer_batch_ms: 150,
            auto_large_project_mode: true,
            warnings: Vec::new(),
        },
        PerformanceProfile::LargeProject => EffectivePerformanceConfig {
            profile,
            parser_workers: auto_workers(cpu_count, 6).max(2),
            background_indexing: BackgroundIndexingMode::Aggressive,
            foreground_task_reserve: true,
            index_hot_cache_mb: 1024,
            search_result_cache_mb: 256,
            opened_document_cache_mb: 256,
            writer_batch_files: 256,
            writer_batch_ms: 200,
            auto_large_project_mode: true,
            warnings: Vec::new(),
        },
        PerformanceProfile::LowMemory => EffectivePerformanceConfig {
            profile,
            parser_workers: auto_workers(cpu_count, 2),
            background_indexing: BackgroundIndexingMode::Conservative,
            foreground_task_reserve: true,
            index_hot_cache_mb: 128,
            search_result_cache_mb: 64,
            opened_document_cache_mb: 64,
            writer_batch_files: 64,
            writer_batch_ms: 100,
            auto_large_project_mode: false,
            warnings: Vec::new(),
        },
    }
}

fn auto_workers(cpu_count: usize, cap: usize) -> usize {
    cpu_count.saturating_sub(1).max(1).min(cap)
}

fn cpu_count(settings: &PerformanceUserSettings) -> usize {
    settings.cpu_count.unwrap_or_else(|| {
        thread::available_parallelism()
            .map(|value| value.get())
            .unwrap_or(1)
    })
}

fn clamp_usize(
    field: &str,
    value: usize,
    min: usize,
    max: usize,
    warnings: &mut Vec<PerformanceConfigWarning>,
) -> usize {
    if value < min {
        warnings.push(warning(
            &format!("{field}.clamped"),
            &format!("{field} was below {min}; {min} was used."),
        ));
        return min;
    }
    if value > max {
        warnings.push(warning(
            &format!("{field}.clamped"),
            &format!("{field} was above {max}; {max} was used."),
        ));
        return max;
    }
    value
}

fn clamp_u64(
    field: &str,
    value: u64,
    min: u64,
    max: u64,
    warnings: &mut Vec<PerformanceConfigWarning>,
) -> u64 {
    if value < min {
        warnings.push(warning(
            &format!("{field}.clamped"),
            &format!("{field} was below {min}; {min} was used."),
        ));
        return min;
    }
    if value > max {
        warnings.push(warning(
            &format!("{field}.clamped"),
            &format!("{field} was above {max}; {max} was used."),
        ));
        return max;
    }
    value
}

fn warning(code: &str, message: &str) -> PerformanceConfigWarning {
    PerformanceConfigWarning {
        code: code.to_string(),
        message: message.to_string(),
    }
}
