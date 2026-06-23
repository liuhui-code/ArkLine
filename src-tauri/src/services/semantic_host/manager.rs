use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::config::SemanticHostConfig;
use super::process::{discover_semantic_worker, SemanticWorkerDiscovery, SemanticWorkerProcessSpec};
use super::session::SemanticWorkerSession;
use super::sdk::{discover_harmony_sdk, SdkDiscovery};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticHostReadiness {
    config: SemanticHostConfig,
    pub sdk: SdkDiscovery,
    pub worker: SemanticWorkerDiscovery,
}

pub struct SemanticHostManager {
    readiness: SemanticHostReadiness,
    session: Mutex<Option<Arc<SemanticWorkerSession>>>,
}

impl SemanticHostReadiness {
    pub fn discover(config: SemanticHostConfig) -> Self {
        Self {
            sdk: discover_harmony_sdk(
                config.harmony_sdk_env_value().as_deref(),
            ),
            worker: discover_semantic_worker(&config),
            config,
        }
    }

    pub fn is_ready(&self) -> bool {
        self.worker.entry_path.is_some() && self.worker.node_path.is_some()
    }

    pub fn has_sdk(&self) -> bool {
        matches!(self.sdk, SdkDiscovery::Ready(_))
    }

    pub fn sdk_path(&self) -> Option<&PathBuf> {
        match &self.sdk {
            SdkDiscovery::Ready(path) => Some(path),
            SdkDiscovery::Missing => None,
        }
    }

    pub fn detail(&self) -> String {
        let sdk_detail = match self.sdk_path() {
            Some(path) => format!("SDK ready at {}", path.display()),
            None => "HarmonyOS SDK path is not configured; independent semantic worker mode remains available".to_string(),
        };

        if self.is_ready() {
            return format!("{sdk_detail}; {}", self.worker.detail);
        }

        format!("{sdk_detail}; {}", self.worker.detail)
    }
}

impl SemanticHostManager {
    pub fn discover(config: SemanticHostConfig) -> Self {
        Self {
            readiness: SemanticHostReadiness::discover(config),
            session: Mutex::new(None),
        }
    }

    pub fn readiness(&self) -> &SemanticHostReadiness {
        &self.readiness
    }

    pub fn session(&self) -> Result<Arc<SemanticWorkerSession>, String> {
        if !self.readiness.is_ready() {
            return Err(self.readiness.detail());
        }

        let mut guard = self
            .session
            .lock()
            .map_err(|_| "Semantic host manager session lock is poisoned".to_string())?;

        if let Some(existing) = guard.as_ref() {
            if existing.health().is_ok() {
                return Ok(existing.clone());
            }
            *guard = None;
        }

        self.readiness.config.apply_to_process_env();
        let spec = SemanticWorkerProcessSpec::discover_with_config(&self.readiness.config)?;
        let session = Arc::new(SemanticWorkerSession::start(&spec)?);
        session.health()?;
        *guard = Some(session.clone());

        Ok(session)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{SemanticHostManager, SemanticHostReadiness};
    use crate::services::semantic_host::config::SemanticHostConfig;
    use crate::services::semantic_host::sdk::HARMONY_SDK_PATH_ENV;

    #[test]
    fn host_is_not_ready_without_sdk_and_worker() {
        let readiness = SemanticHostReadiness::discover(SemanticHostConfig::default());

        if readiness.is_ready() {
            assert!(readiness.detail().contains("Semantic worker is ready"));
        } else {
            assert!(!readiness.detail().is_empty());
        }
    }

    #[test]
    fn reuses_the_same_worker_session_while_it_is_healthy() {
        let temp_sdk_root = std::env::temp_dir().join(format!(
            "arkline-sdk-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after unix epoch")
                .as_nanos()
        ));
        fs::create_dir_all(temp_sdk_root.join("ets")).unwrap();
        fs::create_dir_all(temp_sdk_root.join("toolchains")).unwrap();
        let previous = std::env::var(HARMONY_SDK_PATH_ENV).ok();
        std::env::set_var(HARMONY_SDK_PATH_ENV, temp_sdk_root.to_string_lossy().to_string());

        let manager = SemanticHostManager::discover(SemanticHostConfig {
            harmony_sdk_path: Some(temp_sdk_root.to_string_lossy().to_string()),
            harmony_sdk_auto_detect: false,
            semantic_worker_path: None,
            node_path: None,
        });
        let first = manager.session().expect("first session should start");
        let second = manager.session().expect("second session should reuse");

        assert!(std::sync::Arc::ptr_eq(&first, &second));

        drop(first);
        drop(second);
        if let Some(value) = previous {
            std::env::set_var(HARMONY_SDK_PATH_ENV, value);
        } else {
            std::env::remove_var(HARMONY_SDK_PATH_ENV);
        }
        fs::remove_dir_all(temp_sdk_root).unwrap();
    }
}
