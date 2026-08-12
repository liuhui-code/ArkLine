const FOREGROUND_INDEX_SCHEDULE_TTL_MS = 750;
const MAX_TRACKED_FOREGROUND_SCHEDULES = 128;
const FOREGROUND_INDEX_IDLE_TIMEOUT_MS = 250;
const FOREGROUND_INDEX_FALLBACK_DELAY_MS = 50;

const recentForegroundSchedules = new Map<string, number>();

export function shouldScheduleForegroundIndex(
  kind: "completion" | "navigation" | "visible",
  rootPath: string,
  path: string,
  now = Date.now(),
) {
  // The client only deduplicates duplicate dispatches. Priority lanes and
  // workspace-wide admission live in the index manager so callers cannot
  // suppress a higher-priority navigation request by accident.
  const key = `${kind}\0${rootPath}\0${path}`;
  const previous = recentForegroundSchedules.get(key);
  if (previous !== undefined && now - previous < FOREGROUND_INDEX_SCHEDULE_TTL_MS) {
    return false;
  }
  recentForegroundSchedules.set(key, now);
  trimOldForegroundSchedules(now);
  return true;
}

export function resetForegroundIndexScheduleGate() {
  recentForegroundSchedules.clear();
}

export function deferForegroundIndexSchedule(
  dispatch: () => Promise<void>,
  host: ForegroundIndexScheduleHost = globalThis,
) {
  const run = () => {
    void dispatch().catch(() => {
      // Index scheduling is a background hint, never a query prerequisite.
    });
  };
  if (host.requestIdleCallback) {
    host.requestIdleCallback(run, { timeout: FOREGROUND_INDEX_IDLE_TIMEOUT_MS });
    return;
  }
  host.setTimeout(run, FOREGROUND_INDEX_FALLBACK_DELAY_MS);
}

type ForegroundIndexScheduleHost = {
  requestIdleCallback?: (callback: () => void, options: { timeout: number }) => unknown;
  setTimeout(callback: () => void, delay: number): unknown;
};

function trimOldForegroundSchedules(now: number) {
  if (recentForegroundSchedules.size <= MAX_TRACKED_FOREGROUND_SCHEDULES) {
    return;
  }
  for (const [key, timestamp] of recentForegroundSchedules) {
    if (now - timestamp >= FOREGROUND_INDEX_SCHEDULE_TTL_MS) {
      recentForegroundSchedules.delete(key);
    }
  }
  while (recentForegroundSchedules.size > MAX_TRACKED_FOREGROUND_SCHEDULES) {
    const oldestKey = recentForegroundSchedules.keys().next().value;
    if (!oldestKey) break;
    recentForegroundSchedules.delete(oldestKey);
  }
}
