use std::sync::Arc;

use super::SemanticHostManager;
use crate::services::semantic_host::session::SemanticWorkerSession;

impl SemanticHostManager {
    pub fn request<T>(
        &self,
        operation: impl Fn(&SemanticWorkerSession) -> Result<T, String>,
    ) -> Result<T, String> {
        let session = self.session()?;
        match operation(&session) {
            Ok(value) => self.finish_success(&session, value),
            Err(first_error) => {
                self.supervisor.mark_transient_failure(&first_error);
                self.invalidate(&session);
                let restarted = self.start_session(true).map_err(|restart_error| {
                    format!(
                        "Semantic worker request failed ({first_error}); restart failed: {restart_error}"
                    )
                })?;
                match operation(&restarted) {
                    Ok(value) => self.finish_success(&restarted, value),
                    Err(retry_error) => {
                        self.supervisor.mark_terminal_failure(&retry_error);
                        self.invalidate(&restarted);
                        Err(format!(
                            "Semantic worker request failed ({first_error}); retry failed: {retry_error}"
                        ))
                    }
                }
            }
        }
    }

    pub fn request_interactive<T>(
        &self,
        operation: impl FnOnce(&SemanticWorkerSession) -> Result<T, String>,
    ) -> Result<T, String> {
        let session = self.session()?;
        match operation(&session) {
            Ok(value) => self.finish_success(&session, value),
            Err(error) => {
                self.supervisor.mark_transient_failure(&error);
                self.invalidate(&session);
                Err(error)
            }
        }
    }

    fn finish_success<T>(
        &self,
        session: &Arc<SemanticWorkerSession>,
        value: T,
    ) -> Result<T, String> {
        if self.supervisor.mark_success(session.runtime_snapshot()) {
            self.invalidate(session);
        }
        Ok(value)
    }

    pub(super) fn invalidate(&self, failed: &Arc<SemanticWorkerSession>) {
        let Ok(mut guard) = self.session.lock() else {
            return;
        };
        if guard
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, failed))
        {
            *guard = None;
        }
    }
}
