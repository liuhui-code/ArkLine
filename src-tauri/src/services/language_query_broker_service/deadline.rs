use std::time::{Duration, Instant};

use tauri::async_runtime::JoinHandle;

const COMPLETION_SEMANTIC_BUDGET: Duration = Duration::from_millis(80);
const COMPLETION_SEMANTIC_ENRICHMENT_BUDGET: Duration = Duration::from_millis(24);
const DEFINITION_SEMANTIC_BUDGET: Duration = Duration::from_millis(2_500);
const DEFINITION_SEMANTIC_ENRICHMENT_BUDGET: Duration = Duration::from_millis(180);

#[derive(Debug, PartialEq, Eq)]
pub enum SemanticDeadlineOutcome<T> {
    Ready(T),
    Failed(String),
    TimedOut,
}

pub fn completion_semantic_budget(has_indexed_results: bool) -> Duration {
    if has_indexed_results {
        COMPLETION_SEMANTIC_ENRICHMENT_BUDGET
    } else {
        COMPLETION_SEMANTIC_BUDGET
    }
}

pub fn definition_semantic_budget(has_indexed_results: bool) -> Duration {
    if has_indexed_results {
        DEFINITION_SEMANTIC_ENRICHMENT_BUDGET
    } else {
        DEFINITION_SEMANTIC_BUDGET
    }
}

pub async fn await_semantic_until<T>(
    mut task: JoinHandle<Result<T, String>>,
    started_at: Instant,
    budget: Duration,
) -> SemanticDeadlineOutcome<T> {
    let remaining = budget.saturating_sub(started_at.elapsed());
    if remaining.is_zero() {
        if task.inner().is_finished() {
            return match task.await {
                Ok(Ok(value)) => SemanticDeadlineOutcome::Ready(value),
                Ok(Err(error)) => SemanticDeadlineOutcome::Failed(error),
                Err(error) => SemanticDeadlineOutcome::Failed(error.to_string()),
            };
        }
        task.abort();
        return SemanticDeadlineOutcome::TimedOut;
    }
    match tokio::time::timeout(remaining, &mut task).await {
        Ok(Ok(Ok(value))) => SemanticDeadlineOutcome::Ready(value),
        Ok(Ok(Err(error))) => SemanticDeadlineOutcome::Failed(error),
        Ok(Err(error)) => SemanticDeadlineOutcome::Failed(error.to_string()),
        Err(_) => {
            task.abort();
            SemanticDeadlineOutcome::TimedOut
        }
    }
}

pub fn elapsed_millis(started_at: Instant) -> u128 {
    started_at.elapsed().as_millis()
}

#[cfg(test)]
mod tests {
    use super::{
        await_semantic_until, completion_semantic_budget, definition_semantic_budget,
        SemanticDeadlineOutcome,
    };
    use std::time::{Duration, Instant};

    #[test]
    fn returns_without_waiting_for_a_slow_semantic_task() {
        tauri::async_runtime::block_on(async {
            let (_release_task, wait_for_release) = tokio::sync::oneshot::channel::<()>();
            let task = tauri::async_runtime::spawn(async move {
                let _ = wait_for_release.await;
                Ok::<_, String>(vec!["late"])
            });
            let started = Instant::now();
            let outcome = await_semantic_until(task, started, Duration::from_millis(10)).await;

            assert_eq!(outcome, SemanticDeadlineOutcome::TimedOut);
        });
    }

    #[test]
    fn keeps_a_semantic_result_that_arrives_inside_the_budget() {
        tauri::async_runtime::block_on(async {
            let task = tauri::async_runtime::spawn(async { Ok::<_, String>(vec!["ready"]) });
            let outcome =
                await_semantic_until(task, Instant::now(), Duration::from_millis(50)).await;

            assert_eq!(outcome, SemanticDeadlineOutcome::Ready(vec!["ready"]));
        });
    }

    #[test]
    fn keeps_an_already_finished_result_when_index_work_consumed_the_budget() {
        tauri::async_runtime::block_on(async {
            let task = tauri::async_runtime::spawn(async { Ok::<_, String>(vec!["ready"]) });
            tokio::time::sleep(Duration::from_millis(5)).await;
            let started = Instant::now() - Duration::from_millis(20);

            let outcome = await_semantic_until(task, started, Duration::from_millis(10)).await;

            assert_eq!(outcome, SemanticDeadlineOutcome::Ready(vec!["ready"]));
        });
    }

    #[test]
    fn gives_indexed_completions_a_short_semantic_enrichment_window() {
        assert_eq!(completion_semantic_budget(true), Duration::from_millis(24));
        assert_eq!(completion_semantic_budget(false), Duration::from_millis(80));
    }

    #[test]
    fn waits_for_authoritative_definition_only_when_the_index_has_no_target() {
        assert_eq!(definition_semantic_budget(true), Duration::from_millis(180));
        assert_eq!(
            definition_semantic_budget(false),
            Duration::from_millis(2_500)
        );
    }
}
