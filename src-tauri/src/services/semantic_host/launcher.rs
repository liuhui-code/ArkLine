use std::path::PathBuf;
use std::sync::Arc;

use super::config::SemanticHostConfig;
use super::process::{
    discover_semantic_worker, SemanticWorkerDiscovery, SemanticWorkerProcessSpec,
};
use super::transport::{
    DirectSemanticWorkerTransport, SemanticWorkerTransport, TauriSidecarTransport,
};

pub const SEMANTIC_SIDECAR_NAME: &str = "arkline-semantic";

pub type SharedSemanticWorkerLauncher = Arc<dyn SemanticWorkerLauncher>;

pub trait SemanticWorkerLauncher: Send + Sync {
    fn discover(&self, config: &SemanticHostConfig) -> SemanticWorkerDiscovery;
    fn launch(
        &self,
        config: &SemanticHostConfig,
    ) -> Result<Box<dyn SemanticWorkerTransport>, String>;
}

#[derive(Default)]
pub struct DirectSemanticWorkerLauncher;

impl SemanticWorkerLauncher for DirectSemanticWorkerLauncher {
    fn discover(&self, config: &SemanticHostConfig) -> SemanticWorkerDiscovery {
        discover_semantic_worker(config)
    }

    fn launch(
        &self,
        config: &SemanticHostConfig,
    ) -> Result<Box<dyn SemanticWorkerTransport>, String> {
        let spec = SemanticWorkerProcessSpec::discover_with_config(config)?;
        Ok(Box::new(DirectSemanticWorkerTransport::start(&spec)?))
    }
}

pub struct TauriSemanticWorkerLauncher {
    app: tauri::AppHandle,
    direct: DirectSemanticWorkerLauncher,
    bundled_sidecar: bool,
}

impl TauriSemanticWorkerLauncher {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self {
            app,
            direct: DirectSemanticWorkerLauncher,
            bundled_sidecar: !cfg!(debug_assertions),
        }
    }

    fn uses_direct_worker(&self, config: &SemanticHostConfig) -> bool {
        !self.bundled_sidecar || config.semantic_worker_path.is_some()
    }
}

impl SemanticWorkerLauncher for TauriSemanticWorkerLauncher {
    fn discover(&self, config: &SemanticHostConfig) -> SemanticWorkerDiscovery {
        if self.uses_direct_worker(config) {
            return self.direct.discover(config);
        }

        SemanticWorkerDiscovery {
            entry_path: Some(PathBuf::from(format!("sidecar:{SEMANTIC_SIDECAR_NAME}"))),
            node_path: None,
            standalone: true,
            detail: format!(
                "Bundled semantic sidecar {SEMANTIC_SIDECAR_NAME} is configured for launch"
            ),
        }
    }

    fn launch(
        &self,
        config: &SemanticHostConfig,
    ) -> Result<Box<dyn SemanticWorkerTransport>, String> {
        if self.uses_direct_worker(config) {
            return self.direct.launch(config);
        }

        Ok(Box::new(TauriSidecarTransport::start(
            &self.app,
            SEMANTIC_SIDECAR_NAME,
        )?))
    }
}

pub fn direct_semantic_worker_launcher() -> SharedSemanticWorkerLauncher {
    Arc::new(DirectSemanticWorkerLauncher)
}
