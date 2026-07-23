use std::collections::VecDeque;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PublicationPriority {
    Maintenance,
    Foreground,
    Background,
    IdleMaintenance,
}

pub(crate) struct WorkspaceIndexPublicationQueue<T> {
    maintenance: VecDeque<QueuedPublication<T>>,
    foreground: VecDeque<QueuedPublication<T>>,
    background: VecDeque<QueuedPublication<T>>,
    idle_maintenance: VecDeque<QueuedPublication<T>>,
    foreground_burst_limit: usize,
    foreground_burst: usize,
    next_sequence: u64,
}

struct QueuedPublication<T> {
    sequence: u64,
    value: T,
}

impl<T> WorkspaceIndexPublicationQueue<T> {
    pub(crate) fn new(foreground_burst_limit: usize) -> Self {
        Self {
            maintenance: VecDeque::new(),
            foreground: VecDeque::new(),
            background: VecDeque::new(),
            idle_maintenance: VecDeque::new(),
            foreground_burst_limit: foreground_burst_limit.max(1),
            foreground_burst: 0,
            next_sequence: 0,
        }
    }

    pub(crate) fn push(&mut self, priority: PublicationPriority, value: T) {
        self.next_sequence = self.next_sequence.saturating_add(1);
        let publication = QueuedPublication {
            sequence: self.next_sequence,
            value,
        };
        match priority {
            PublicationPriority::Maintenance => self.maintenance.push_back(publication),
            PublicationPriority::Foreground => self.foreground.push_back(publication),
            PublicationPriority::Background => self.background.push_back(publication),
            PublicationPriority::IdleMaintenance => self.idle_maintenance.push_back(publication),
        }
    }

    pub(crate) fn pop(&mut self) -> Option<T> {
        let barrier = self
            .maintenance
            .front()
            .map(|publication| publication.sequence);
        if !self.background.is_empty()
            && self
                .background
                .front()
                .is_some_and(|item| barrier.is_none_or(|barrier| item.sequence < barrier))
            && (!self
                .foreground
                .front()
                .is_some_and(|item| barrier.is_none_or(|barrier| item.sequence < barrier))
                || self.foreground_burst >= self.foreground_burst_limit)
        {
            self.foreground_burst = 0;
            return self.background.pop_front().map(|item| item.value);
        }
        let value = self
            .foreground
            .front()
            .is_some_and(|item| barrier.is_none_or(|barrier| item.sequence < barrier))
            .then(|| self.foreground.pop_front())
            .flatten()
            .map(|item| item.value);
        if value.is_some() {
            self.foreground_burst = self.foreground_burst.saturating_add(1);
            return value;
        }
        self.foreground_burst = 0;
        if self
            .background
            .front()
            .is_some_and(|item| barrier.is_none_or(|barrier| item.sequence < barrier))
        {
            return self.background.pop_front().map(|item| item.value);
        }
        if self
            .idle_maintenance
            .front()
            .is_some_and(|item| barrier.is_none_or(|barrier| item.sequence < barrier))
        {
            return self.idle_maintenance.pop_front().map(|item| item.value);
        }
        self.maintenance
            .pop_front()
            .map(|publication| publication.value)
    }
}

#[cfg(test)]
mod tests {
    use super::{PublicationPriority, WorkspaceIndexPublicationQueue};

    #[test]
    fn background_publication_runs_after_a_bounded_foreground_burst() {
        let mut queue = WorkspaceIndexPublicationQueue::new(2);
        queue.push(PublicationPriority::Foreground, "foreground-1");
        queue.push(PublicationPriority::Foreground, "foreground-2");
        queue.push(PublicationPriority::Foreground, "foreground-3");
        queue.push(PublicationPriority::Background, "background-1");

        assert_eq!(queue.pop(), Some("foreground-1"));
        assert_eq!(queue.pop(), Some("foreground-2"));
        assert_eq!(queue.pop(), Some("background-1"));
        assert_eq!(queue.pop(), Some("foreground-3"));
    }

    #[test]
    fn maintenance_is_a_fifo_barrier_for_priority_publications() {
        let mut queue = WorkspaceIndexPublicationQueue::new(2);
        queue.push(PublicationPriority::Background, "older-background");
        queue.push(PublicationPriority::Maintenance, "maintenance");
        queue.push(PublicationPriority::Foreground, "newer-foreground");

        assert_eq!(queue.pop(), Some("older-background"));
        assert_eq!(queue.pop(), Some("maintenance"));
        assert_eq!(queue.pop(), Some("newer-foreground"));
    }

    #[test]
    fn idle_maintenance_yields_to_newer_background_publication() {
        let mut queue = WorkspaceIndexPublicationQueue::new(2);
        queue.push(PublicationPriority::IdleMaintenance, "idle-maintenance");
        queue.push(PublicationPriority::Background, "background");

        assert_eq!(queue.pop(), Some("background"));
        assert_eq!(queue.pop(), Some("idle-maintenance"));
    }

    #[test]
    fn reset_barrier_waits_for_older_idle_maintenance() {
        let mut queue = WorkspaceIndexPublicationQueue::new(2);
        queue.push(PublicationPriority::IdleMaintenance, "older-idle");
        queue.push(PublicationPriority::Maintenance, "reset");
        queue.push(PublicationPriority::IdleMaintenance, "newer-idle");

        assert_eq!(queue.pop(), Some("older-idle"));
        assert_eq!(queue.pop(), Some("reset"));
        assert_eq!(queue.pop(), Some("newer-idle"));
    }
}
