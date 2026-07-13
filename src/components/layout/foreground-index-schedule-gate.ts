const FOREGROUND_INDEX_SCHEDULE_TTL_MS = 750;
const MAX_TRACKED_FOREGROUND_SCHEDULES = 128;

const recentForegroundSchedules = new Map<string, number>();

export function shouldScheduleForegroundIndex(
  kind: "completion" | "navigation" | "visible",
  rootPath: string,
  path: string,
  now = Date.now(),
) {
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
