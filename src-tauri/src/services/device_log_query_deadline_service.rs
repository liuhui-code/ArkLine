use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy)]
pub struct DeviceLogQueryDeadline {
    started: Instant,
    budget: Duration,
}

impl DeviceLogQueryDeadline {
    pub fn new(started: Instant, budget: Duration) -> Self {
        Self { started, budget }
    }

    pub fn expired(&self) -> bool {
        self.started.elapsed() >= self.budget
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_budget_expires_immediately() {
        let deadline = DeviceLogQueryDeadline::new(Instant::now(), Duration::ZERO);

        assert!(deadline.expired());
    }

    #[test]
    fn positive_budget_starts_open() {
        let deadline = DeviceLogQueryDeadline::new(Instant::now(), Duration::from_secs(60));

        assert!(!deadline.expired());
    }
}
