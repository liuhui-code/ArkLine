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

#[cfg(test)]
mod tests {
    use super::indexer_enabled;

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
}
