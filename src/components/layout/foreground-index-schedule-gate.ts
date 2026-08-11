const FOREGROUND_INDEX_SCHEDULE_TTL_MS = 5_000;
const MAX_TRACKED_FOREGROUND_SCHEDULES = 32;

const recentForegroundSchedules = new Map<string, number>();

export function shouldScheduleForegroundIndex(
  _kind: "completion" | "navigation" | "visible",
  rootPath: string,
  _path: string,
  now = Date.now(),
) {
  // Foreground indexing is a best-effort readiness hint. A fast file switch or
  // completion burst must not turn every distinct path into a new worker task.
  // Semantic requests carry the current document separately, so they remain
  // responsive while the shared workspace cooldown absorbs the burst.
  const key = rootPath;
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
