#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexChunkProgress {
    pub current_chunk: usize,
    pub total_chunks: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexRefreshChunk<T> {
    pub paths: Vec<T>,
    pub progress: WorkspaceIndexChunkProgress,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceIndexRefreshContinuation<T> {
    pub root_path: String,
    pub generation: u64,
    chunks: Vec<Vec<T>>,
    processed_chunks: usize,
    total_chunks: usize,
}

impl<T> WorkspaceIndexRefreshContinuation<T> {
    pub fn pop_next_chunk(&mut self) -> Option<WorkspaceIndexRefreshChunk<T>> {
        if self.chunks.is_empty() {
            return None;
        }
        let progress = chunk_progress(self.processed_chunks, self.total_chunks);
        let paths = self.chunks.remove(0);
        self.processed_chunks += 1;
        Some(WorkspaceIndexRefreshChunk { paths, progress })
    }

    #[allow(dead_code)]
    pub fn remaining_chunk_count(&self) -> usize {
        self.chunks.len()
    }

    #[allow(dead_code)]
    pub fn is_complete(&self) -> bool {
        self.remaining_chunk_count() == 0
    }
}

impl<T: Clone> WorkspaceIndexRefreshContinuation<T> {
    #[allow(dead_code)]
    pub fn next_chunk_paths(&self) -> Option<Vec<T>> {
        self.chunks.first().cloned()
    }

    pub fn remaining_paths(&self) -> Vec<T> {
        self.chunks
            .iter()
            .flat_map(|chunk| chunk.iter().cloned())
            .collect()
    }
}

pub fn chunk_paths<T>(paths: Vec<T>, limit: usize) -> Vec<Vec<T>> {
    if paths.is_empty() {
        return Vec::new();
    }
    if limit == 0 {
        return vec![paths];
    }
    let chunk_size = limit.max(1);
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    for path in paths {
        current.push(path);
        if current.len() == chunk_size {
            chunks.push(current);
            current = Vec::new();
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

#[allow(dead_code)]
pub fn chunk_count(item_count: usize, limit: usize) -> usize {
    if item_count == 0 {
        return 0;
    }
    if limit == 0 {
        return 1;
    }
    let chunk_size = limit.max(1);
    item_count.div_ceil(chunk_size)
}

#[allow(dead_code)]
pub fn chunk_progress(chunk_index: usize, total_chunks: usize) -> WorkspaceIndexChunkProgress {
    WorkspaceIndexChunkProgress {
        current_chunk: (chunk_index + 1).min(total_chunks),
        total_chunks,
    }
}

pub fn plan_refresh_continuation<T>(
    root_path: &str,
    generation: u64,
    paths: Vec<T>,
    limit: usize,
) -> WorkspaceIndexRefreshContinuation<T> {
    let chunks = chunk_paths(paths, limit);
    let total_chunks = chunks.len();
    WorkspaceIndexRefreshContinuation {
        root_path: root_path.to_string(),
        generation,
        chunks,
        processed_chunks: 0,
        total_chunks,
    }
}
