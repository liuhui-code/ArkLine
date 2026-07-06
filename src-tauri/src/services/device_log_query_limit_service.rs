pub(crate) const DEVICE_LOG_QUERY_MAX_LIMIT: usize = 2_000;

pub(crate) fn normalize_query_limit(limit: usize) -> usize {
    limit.clamp(1, DEVICE_LOG_QUERY_MAX_LIMIT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_normal_query_limits() {
        assert_eq!(normalize_query_limit(500), 500);
    }

    #[test]
    fn raises_zero_limit_to_one_row() {
        assert_eq!(normalize_query_limit(0), 1);
    }

    #[test]
    fn caps_oversized_query_limits() {
        assert_eq!(
            normalize_query_limit(usize::MAX),
            DEVICE_LOG_QUERY_MAX_LIMIT
        );
    }
}
