export type LatestRequestOutcome<T> =
  | { status: "completed"; generation: number; value: T; durationMs: number }
  | { status: "superseded"; generation: number };

export type LatestRequestSchedulerSnapshot = {
  running: boolean;
  pending: boolean;
  submitted: number;
  completed: number;
  superseded: number;
  failed: number;
  lastDurationMs: number | null;
};

type ScheduledRequest<T> = {
  generation: number;
  operation: () => Promise<T>;
  resolve: (outcome: LatestRequestOutcome<T>) => void;
  reject: (error: unknown) => void;
};

export function createLatestRequestScheduler(now: () => number = defaultNow) {
  let generation = 0;
  let running = false;
  let pending: ScheduledRequest<unknown> | null = null;
  const stats = {
    submitted: 0,
    completed: 0,
    superseded: 0,
    failed: 0,
    lastDurationMs: null as number | null,
  };

  function schedule<T>(operation: () => Promise<T>): Promise<LatestRequestOutcome<T>> {
    const requestGeneration = ++generation;
    stats.submitted += 1;
    supersedePending();

    return new Promise((resolve, reject) => {
      const request: ScheduledRequest<T> = {
        generation: requestGeneration,
        operation,
        resolve,
        reject,
      };
      if (running) {
        pending = request as ScheduledRequest<unknown>;
        return;
      }
      void run(request as ScheduledRequest<unknown>);
    });
  }

  function cancel() {
    generation += 1;
    supersedePending();
  }

  function snapshot(): LatestRequestSchedulerSnapshot {
    return {
      running,
      pending: pending !== null,
      ...stats,
    };
  }

  function supersedePending() {
    const stale = pending;
    pending = null;
    if (!stale) return;
    stats.superseded += 1;
    stale.resolve({ status: "superseded", generation: stale.generation });
  }

  async function run(request: ScheduledRequest<unknown>) {
    running = true;
    const startedAt = now();
    try {
      const value = await request.operation();
      const durationMs = Math.max(0, now() - startedAt);
      stats.lastDurationMs = durationMs;
      if (request.generation !== generation) {
        stats.superseded += 1;
        request.resolve({ status: "superseded", generation: request.generation });
      } else {
        stats.completed += 1;
        request.resolve({ status: "completed", generation: request.generation, value, durationMs });
      }
    } catch (error) {
      if (request.generation !== generation) {
        stats.superseded += 1;
        request.resolve({ status: "superseded", generation: request.generation });
      } else {
        stats.failed += 1;
        request.reject(error);
      }
    } finally {
      running = false;
      const next = pending;
      pending = null;
      if (next) void run(next);
    }
  }

  return { schedule, cancel, snapshot };
}

function defaultNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
