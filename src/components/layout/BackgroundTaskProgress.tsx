import { useState } from "react";
import type { BackgroundTask } from "@/components/layout/background-task-model";
import "./background-task-progress.css";

type BackgroundTaskProgressProps = {
  tasks: BackgroundTask[];
  onCancelTask?: (taskId: string) => void;
};

export function BackgroundTaskProgress({ tasks, onCancelTask }: BackgroundTaskProgressProps) {
  const [open, setOpen] = useState(false);
  const task = tasks[0];
  if (!task) return null;

  return (
    <div className="status-background-tasks">
      <button
        type="button"
        className="status-background-task"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Background Tasks: ${tasks.length} running`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="status-background-task__pulse" aria-hidden="true" />
        <span className="status-background-task__title">{task.title}</span>
        <TaskProgress task={task} />
      </button>
      {open ? (
        <section
          className="status-background-tasks__popup"
          role="dialog"
          aria-label="Background Tasks"
          aria-live="polite"
        >
          <header>
            <strong>Background Tasks</strong>
            <span>{tasks.length} active</span>
          </header>
          <ul>
            {tasks.map((item) => (
              <li key={item.id}>
                <div className="status-background-tasks__description">
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
                <TaskProgress task={item} />
                {item.cancellable && onCancelTask ? (
                  <button
                    type="button"
                    className="status-background-tasks__stop"
                    aria-label={`Cancel ${item.title}`}
                    onClick={() => onCancelTask(item.id)}
                  >
                    Stop
                  </button>
                ) : <span className="status-background-tasks__stop-spacer" />}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function TaskProgress({ task }: { task: BackgroundTask }) {
  if (!task.progress) {
    return <progress className="status-background-task__progress" aria-label={`${task.title} progress`} />;
  }
  const percentage = task.progress.total > 0
    ? Math.round((task.progress.current / task.progress.total) * 100)
    : 0;
  return (
    <div className="status-background-task__progress-group">
      <progress
        className="status-background-task__progress"
        aria-label={`${task.title} progress`}
        aria-valuenow={task.progress.current}
        max={task.progress.total}
        value={task.progress.current}
      />
      <span>{percentage}%</span>
    </div>
  );
}
