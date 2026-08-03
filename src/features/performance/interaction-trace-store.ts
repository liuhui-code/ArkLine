export type InteractionTraceStatus = "running" | "ok" | "error" | "cancelled" | "superseded";

export type InteractionTracePhase = {
  name: string;
  startedAt: number;
  durationMs: number;
  status: Exclude<InteractionTraceStatus, "running">;
  detail?: string;
};

export type InteractionTrace = {
  id: string;
  parentId?: string;
  kind: string;
  label: string;
  generation?: number;
  attributes?: Record<string, string | number | boolean>;
  startedAt: number;
  durationMs?: number;
  status: InteractionTraceStatus;
  phases: InteractionTracePhase[];
};

export type InteractionTraceHandle = {
  id: string;
  startPhase(name: string, startedAt?: number): InteractionTracePhaseHandle;
  finish(status?: Exclude<InteractionTraceStatus, "running">, endedAt?: number): void;
};

export type InteractionTracePhaseHandle = {
  finish(
    status?: Exclude<InteractionTraceStatus, "running">,
    detail?: string,
    endedAt?: number,
  ): void;
};

export type InteractionTraceContext = {
  parentId?: string;
  attributes?: Record<string, string | number | boolean>;
};

type TraceSnapshotPublisher = (snapshot: InteractionTrace[]) => void;

export function createInteractionTraceStore(
  limit = 40,
  now = Date.now,
  publishSnapshot?: TraceSnapshotPublisher,
) {
  let sequence = 0;
  let snapshot: InteractionTrace[] = [];
  const listeners = new Set<() => void>();

  function publish(next: InteractionTrace[]) {
    snapshot = next.slice(-Math.max(1, limit));
    publishSnapshot?.([...snapshot]);
    listeners.forEach((listener) => listener());
  }

  function update(id: string, updater: (trace: InteractionTrace) => InteractionTrace) {
    const index = snapshot.findIndex((trace) => trace.id === id);
    if (index < 0) return;
    const next = [...snapshot];
    next[index] = updater(next[index]);
    publish(next);
  }

  function begin(
    kind: string,
    label: string,
    generation?: number,
    context: InteractionTraceContext = {},
  ): InteractionTraceHandle {
    const startedAt = now();
    const id = `${startedAt}:${++sequence}`;
    publish([...snapshot, {
      id,
      kind,
      label,
      generation,
      startedAt,
      status: "running",
      phases: [],
      ...(context.parentId ? { parentId: context.parentId } : {}),
      ...(context.attributes ? { attributes: context.attributes } : {}),
    }]);
    let complete = false;

    return {
      id,
      startPhase(name, phaseStartedAt = now()) {
        let phaseComplete = false;
        return {
          finish(status = "ok", detail, endedAt = now()) {
            if (phaseComplete || complete) return;
            phaseComplete = true;
            update(id, (trace) => ({
              ...trace,
              phases: [...trace.phases, {
                name,
                startedAt: phaseStartedAt,
                durationMs: Math.max(0, endedAt - phaseStartedAt),
                status,
                ...(detail ? { detail } : {}),
              }],
            }));
          },
        };
      },
      finish(status = "ok", endedAt = now()) {
        if (complete) return;
        complete = true;
        update(id, (trace) => ({
          ...trace,
          durationMs: Math.max(0, endedAt - trace.startedAt),
          status,
        }));
      },
    };
  }

  return {
    begin,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      publish([]);
    },
  };
}

declare global {
  interface Window {
    __arklineInteractionTraces?: InteractionTrace[];
  }
}

export const interactionTraceStore = createInteractionTraceStore(120, Date.now, (snapshot) => {
  if (typeof window !== "undefined") window.__arklineInteractionTraces = snapshot;
});

export function beginInteractionTrace(
  kind: string,
  label: string,
  generation?: number,
  context?: InteractionTraceContext,
) {
  return interactionTraceStore.begin(kind, label, generation, context);
}
