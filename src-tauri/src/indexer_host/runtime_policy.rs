pub(super) fn indexer_enabled(explicit: Option<&str>, release_build: bool) -> bool {
    match explicit
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("1" | "true" | "on" | "yes") => true,
        Some("0" | "false" | "off" | "no") => false,
        _ => release_build,
    }
}

pub(super) fn terminal_unavailability_message(
    enabled: bool,
    executable_missing: bool,
    consecutive_failure_count: u32,
    last_error: Option<String>,
) -> Option<String> {
    const MAX_CONSECUTIVE_FAILURES: u32 = 3;
    if !enabled || (!executable_missing && consecutive_failure_count < MAX_CONSECUTIVE_FAILURES) {
        return None;
    }
    Some(last_error.unwrap_or_else(|| "Indexer executable is missing".to_string()))
}

#[cfg(test)]
mod tests {
    use super::{indexer_enabled, terminal_unavailability_message};

    #[test]
    fn release_build_enables_indexer_without_an_override() {
        assert!(indexer_enabled(None, true));
        assert!(indexer_enabled(Some(""), true));
        assert!(indexer_enabled(Some("invalid"), true));
    }

    #[test]
    fn debug_build_keeps_the_local_compatibility_default() {
        assert!(!indexer_enabled(None, false));
        assert!(!indexer_enabled(Some("invalid"), false));
    }

    #[test]
    fn explicit_values_override_the_build_default() {
        for value in ["1", "true", "ON", "yes"] {
            assert!(indexer_enabled(Some(value), false));
        }
        for value in ["0", "false", "OFF", "no"] {
            assert!(!indexer_enabled(Some(value), true));
        }
    }

    #[test]
    fn permanent_sidecar_unavailability_is_terminal() {
        assert_eq!(
            terminal_unavailability_message(true, true, 0, None),
            Some("Indexer executable is missing".to_string())
        );
        assert_eq!(
            terminal_unavailability_message(true, false, 3, Some("crashed".to_string())),
            Some("crashed".to_string())
        );
        assert_eq!(terminal_unavailability_message(true, false, 2, None), None);
        assert_eq!(terminal_unavailability_message(false, true, 9, None), None);
    }
}
