const DEFAULT_PUBLICATION_TARGET_US: u64 = 200_000;
const INITIAL_PATH_COUNT: usize = 16;
const INITIAL_SOURCE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AdaptiveRefreshBudget {
    maximum_path_count: usize,
    maximum_source_bytes: usize,
    path_count: usize,
    source_bytes: usize,
    target_duration_us: u64,
}

impl AdaptiveRefreshBudget {
    pub(crate) fn new(maximum_path_count: usize, maximum_source_bytes: usize) -> Self {
        let maximum_path_count = maximum_path_count.max(1);
        let maximum_source_bytes = maximum_source_bytes.max(1);
        Self {
            maximum_path_count,
            maximum_source_bytes,
            path_count: maximum_path_count.min(INITIAL_PATH_COUNT),
            source_bytes: maximum_source_bytes.min(INITIAL_SOURCE_BYTES),
            target_duration_us: DEFAULT_PUBLICATION_TARGET_US,
        }
    }

    pub(crate) fn path_count(&self) -> usize {
        self.path_count
    }

    pub(crate) fn source_bytes(&self) -> usize {
        self.source_bytes
    }

    pub(crate) fn observe(
        &mut self,
        publication_duration_us: u64,
        path_count: usize,
        source_bytes: usize,
    ) {
        if path_count == 0 || publication_duration_us == 0 {
            return;
        }
        if publication_duration_us > self.target_duration_us {
            self.path_count =
                proportional_budget(path_count, self.target_duration_us, publication_duration_us)
                    .min(self.path_count.saturating_sub(1).max(1));
            if source_bytes > 0 {
                self.source_bytes = proportional_budget(
                    source_bytes,
                    self.target_duration_us,
                    publication_duration_us,
                )
                .min(self.source_bytes.saturating_sub(1).max(1));
            }
        } else if publication_duration_us < self.target_duration_us / 2 {
            self.path_count = grow(self.path_count, self.maximum_path_count);
            self.source_bytes = grow(self.source_bytes, self.maximum_source_bytes);
        }
    }
}

fn proportional_budget(work: usize, target_us: u64, elapsed_us: u64) -> usize {
    let scaled = (work as u128)
        .saturating_mul(target_us as u128)
        .checked_div(elapsed_us.max(1) as u128)
        .unwrap_or(1);
    usize::try_from(scaled).unwrap_or(usize::MAX).max(1)
}

fn grow(current: usize, maximum: usize) -> usize {
    current
        .saturating_add(current.div_ceil(4).max(1))
        .min(maximum)
}

#[cfg(test)]
mod tests {
    use super::AdaptiveRefreshBudget;

    #[test]
    fn starts_conservatively_and_ignores_missing_telemetry() {
        let mut budget = AdaptiveRefreshBudget::new(64, 32 * 1024 * 1024);
        assert_eq!(budget.path_count(), 16);
        assert_eq!(budget.source_bytes(), 8 * 1024 * 1024);

        budget.observe(0, 16, 8 * 1024 * 1024);

        assert_eq!(budget.path_count(), 16);
        assert_eq!(budget.source_bytes(), 8 * 1024 * 1024);
    }

    #[test]
    fn slow_publication_reduces_path_and_byte_budgets() {
        let mut budget = AdaptiveRefreshBudget::new(64, 32 * 1024 * 1024);

        budget.observe(400_000, 16, 8 * 1024 * 1024);

        assert_eq!(budget.path_count(), 8);
        assert_eq!(budget.source_bytes(), 4 * 1024 * 1024);
    }

    #[test]
    fn fast_publication_grows_without_exceeding_protocol_limits() {
        let mut budget = AdaptiveRefreshBudget::new(64, 1_000);
        budget.observe(400_000, 16, 1_000);
        assert_eq!(budget.path_count(), 8);
        assert_eq!(budget.source_bytes(), 500);

        budget.observe(20_000, 8, 500);

        assert_eq!(budget.path_count(), 10);
        assert_eq!(budget.source_bytes(), 625);
    }

    #[test]
    fn removed_only_publication_still_adapts_path_budget() {
        let mut budget = AdaptiveRefreshBudget::new(64, 1_000);

        budget.observe(400_000, 16, 0);

        assert_eq!(budget.path_count(), 8);
        assert_eq!(budget.source_bytes(), 1_000);
    }
}
