const DEFAULT_PUBLICATION_TARGET_US: u64 = 200_000;
const INTERACTIVE_PUBLICATION_TARGET_US: u64 = 50_000;
const INTERACTIVE_MINIMUM_PATH_COUNT: usize = 4;
const INTERACTIVE_MAXIMUM_PATH_COUNT: usize = 8;
const INITIAL_PATH_COUNT: usize = 16;
const INITIAL_SOURCE_BYTES: usize = 8 * 1024 * 1024;
const INTERACTIVE_INITIAL_SOURCE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AdaptiveRefreshBudget {
    minimum_path_count: usize,
    maximum_path_count: usize,
    maximum_source_bytes: usize,
    path_count: usize,
    source_bytes: usize,
    target_duration_us: u64,
}

impl AdaptiveRefreshBudget {
    pub(crate) fn new(maximum_path_count: usize, maximum_source_bytes: usize) -> Self {
        Self::new_for_latency(maximum_path_count, maximum_source_bytes, false)
    }

    pub(crate) fn new_for_latency(
        maximum_path_count: usize,
        maximum_source_bytes: usize,
        ui_latency_sensitive: bool,
    ) -> Self {
        let maximum_path_count = if ui_latency_sensitive {
            maximum_path_count.min(INTERACTIVE_MAXIMUM_PATH_COUNT)
        } else {
            maximum_path_count
        };
        let maximum_path_count = maximum_path_count.max(1);
        let minimum_path_count = if ui_latency_sensitive {
            maximum_path_count.min(INTERACTIVE_MINIMUM_PATH_COUNT)
        } else {
            1
        };
        let maximum_source_bytes = maximum_source_bytes.max(1);
        let initial_source_bytes = if ui_latency_sensitive {
            INTERACTIVE_INITIAL_SOURCE_BYTES
        } else {
            INITIAL_SOURCE_BYTES
        };
        Self {
            minimum_path_count,
            maximum_path_count,
            maximum_source_bytes,
            path_count: maximum_path_count.min(INITIAL_PATH_COUNT),
            source_bytes: maximum_source_bytes.min(initial_source_bytes),
            target_duration_us: if ui_latency_sensitive {
                INTERACTIVE_PUBLICATION_TARGET_US
            } else {
                DEFAULT_PUBLICATION_TARGET_US
            },
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
                    .clamp(
                        self.minimum_path_count,
                        self.path_count
                            .saturating_sub(1)
                            .max(self.minimum_path_count),
                    );
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

    #[test]
    fn interactive_budget_caps_non_preemptible_publication_work() {
        let mut budget = AdaptiveRefreshBudget::new_for_latency(64, 32 * 1024 * 1024, true);

        assert_eq!(budget.path_count(), 8);
        assert_eq!(budget.source_bytes(), 2 * 1024 * 1024);
        budget.observe(400_000, 8, 2 * 1024 * 1024);
        assert_eq!(budget.path_count(), 4);
        budget.observe(400_000, 4, 1 * 1024 * 1024);
        assert_eq!(budget.path_count(), 4);
        assert!(budget.source_bytes() < 2 * 1024 * 1024);
        assert!(budget.source_bytes() > 0);
    }
}
