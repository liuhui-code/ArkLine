import type { DeviceLogFilterState, DeviceLogState } from "@/features/device-log/device-log-model";
import { parseDeviceLogLine } from "@/features/device-log/device-log-parser";

const defaultFilter: DeviceLogFilterState = {
  query: "",
  regex: false,
  matchCase: false,
  levels: [],
  pid: "",
  process: "",
  domain: "",
  tag: "",
};

type DeviceLogStoreOptions = {
  capacity?: number | null;
  now?: () => number;
};

export function createDeviceLogStore({ capacity = null, now = () => Date.now() }: DeviceLogStoreOptions = {}) {
  let state: DeviceLogState = {
    entries: [],
    pendingEntries: [],
    trimmedEntries: 0,
    filter: defaultFilter,
    paused: false,
  };

  function trim<T>(items: T[]) {
    if (capacity == null) {
      return { items, trimmed: 0 };
    }
    if (items.length <= capacity) {
      return { items, trimmed: 0 };
    }
    return {
      items: items.slice(items.length - capacity),
      trimmed: items.length - capacity,
    };
  }

  function parseLines(deviceId: string, lines: string[]) {
    const receivedAt = now();
    return lines
      .filter((line) => line.length > 0)
      .map((line) => ({ ...parseDeviceLogLine(line, deviceId), receivedAt }));
  }

  return {
    getState() {
      return state;
    },
    appendRawLines(deviceId: string, lines: string[]) {
      const entries = parseLines(deviceId, lines);
      if (state.paused) {
        const next = trim([...state.pendingEntries, ...entries]);
        state = { ...state, pendingEntries: next.items, trimmedEntries: state.trimmedEntries + next.trimmed };
        return;
      }
      const next = trim([...state.entries, ...entries]);
      state = { ...state, entries: next.items, trimmedEntries: state.trimmedEntries + next.trimmed };
    },
    appendRawLineBatches(batches: { deviceId: string; lines: string[] }[]) {
      const entries = batches.flatMap((batch) => (
        parseLines(batch.deviceId, batch.lines)
      ));
      if (entries.length === 0) {
        return;
      }
      if (state.paused) {
        const next = trim([...state.pendingEntries, ...entries]);
        state = { ...state, pendingEntries: next.items, trimmedEntries: state.trimmedEntries + next.trimmed };
        return;
      }
      const next = trim([...state.entries, ...entries]);
      state = { ...state, entries: next.items, trimmedEntries: state.trimmedEntries + next.trimmed };
    },
    setPaused(paused: boolean) {
      if (state.paused === paused) {
        return;
      }

      if (!paused) {
        const next = trim([...state.entries, ...state.pendingEntries]);
        state = {
          ...state,
          paused,
          entries: next.items,
          pendingEntries: [],
          trimmedEntries: state.trimmedEntries + next.trimmed,
        };
        return;
      }

      state = { ...state, paused };
    },
    clear() {
      state = { ...state, entries: [], pendingEntries: [], trimmedEntries: 0 };
    },
    setFilter(filter: DeviceLogFilterState) {
      state = { ...state, filter };
    },
    getRecentEntries(windowMs: number) {
      const cutoff = now() - windowMs;
      return state.entries.filter((entry) => entry.receivedAt >= cutoff);
    },
  };
}
