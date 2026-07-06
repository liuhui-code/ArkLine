use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct DeviceLogQueryGenerationRegistry {
    generations: Mutex<HashMap<String, Arc<AtomicU64>>>,
}

impl DeviceLogQueryGenerationRegistry {
    pub fn begin(&self, stream_id: &str) -> DeviceLogQueryToken {
        let generation = self.generation(stream_id);
        let value = generation.fetch_add(1, Ordering::SeqCst) + 1;
        DeviceLogQueryToken { generation, value }
    }

    fn generation(&self, stream_id: &str) -> Arc<AtomicU64> {
        let mut generations = self
            .generations
            .lock()
            .expect("device log query generation lock");
        generations
            .entry(stream_id.to_string())
            .or_insert_with(|| Arc::new(AtomicU64::new(0)))
            .clone()
    }
}

pub struct DeviceLogQueryToken {
    generation: Arc<AtomicU64>,
    value: u64,
}

impl DeviceLogQueryToken {
    pub fn cancelled(&self) -> bool {
        self.generation.load(Ordering::SeqCst) != self.value
    }
}
