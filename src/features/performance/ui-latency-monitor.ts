export type UiInteractionKind =
  | "completion"
  | "globalSearch"
  | "goToDefinition"
  | "openFile"
  | "searchClose"
  | "searchEverywhere"
  | "searchJump";

export type UiLatencySampleKind = UiInteractionKind | "eventLoopLag";

export type UiLatencySample = {
  kind: UiLatencySampleKind;
  startedAt: number;
  durationMs: number;
  label: string;
};

export type UiLatencySnapshot = {
  eventLoopLags: UiLatencySample[];
  interactions: UiLatencySample[];
};

export type UiLatencyMonitorOptions = {
  heartbeatIntervalMs?: number;
  lagThresholdMs?: number;
  retainedSamples?: number;
};

export type UiLatencyMonitor = {
  getSnapshot(): UiLatencySnapshot;
  recordHeartbeat(now: number): void;
  recordInteraction(kind: UiInteractionKind, label: string, startedAt: number, endedAt: number): void;
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 50;
const DEFAULT_LAG_THRESHOLD_MS = 100;
const DEFAULT_RETAINED_SAMPLES = 20;

export function createUiLatencyMonitor(options: UiLatencyMonitorOptions = {}): UiLatencyMonitor {
  const heartbeatIntervalMs = positiveOrDefault(options.heartbeatIntervalMs, DEFAULT_HEARTBEAT_INTERVAL_MS);
  const lagThresholdMs = positiveOrDefault(options.lagThresholdMs, DEFAULT_LAG_THRESHOLD_MS);
  const retainedSamples = positiveOrDefault(options.retainedSamples, DEFAULT_RETAINED_SAMPLES);
  const eventLoopLags: UiLatencySample[] = [];
  const interactions: UiLatencySample[] = [];
  let lastHeartbeat: number | null = null;

  return {
    getSnapshot() {
      return {
        eventLoopLags: [...eventLoopLags],
        interactions: [...interactions],
      };
    },
    recordHeartbeat(now) {
      if (lastHeartbeat == null) {
        lastHeartbeat = now;
        return;
      }
      const gap = Math.max(0, now - lastHeartbeat - heartbeatIntervalMs);
      if (gap >= lagThresholdMs) {
        pushCapped(eventLoopLags, {
          kind: "eventLoopLag",
          startedAt: lastHeartbeat + heartbeatIntervalMs,
          durationMs: gap,
          label: "main-thread",
        }, retainedSamples);
      }
      lastHeartbeat = now;
    },
    recordInteraction(kind, label, startedAt, endedAt) {
      pushCapped(interactions, {
        kind,
        startedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        label,
      }, retainedSamples);
    },
  };
}

function positiveOrDefault(value: number | undefined, fallback: number) {
  return value != null && value > 0 ? value : fallback;
}

function pushCapped<T>(items: T[], item: T, limit: number) {
  items.push(item);
  while (items.length > limit) {
    items.shift();
  }
}
