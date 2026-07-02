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

export function createDeviceLogStore({ capacity = 20_000 }: { capacity?: number } = {}) {
  let state: DeviceLogState = {
    entries: [],
    pendingEntries: [],
    filter: defaultFilter,
    paused: false,
  };

  function trim<T>(items: T[]) {
    return items.length <= capacity ? items : items.slice(items.length - capacity);
  }

  return {
    getState() {
      return state;
    },
    appendRawLines(deviceId: string, lines: string[]) {
      const entries = lines.filter((line) => line.length > 0).map((line) => parseDeviceLogLine(line, deviceId));
      if (state.paused) {
        state = { ...state, pendingEntries: trim([...state.pendingEntries, ...entries]) };
        return;
      }
      state = { ...state, entries: trim([...state.entries, ...entries]) };
    },
    appendRawLineBatches(batches: { deviceId: string; lines: string[] }[]) {
      const entries = batches.flatMap((batch) => (
        batch.lines.filter((line) => line.length > 0).map((line) => parseDeviceLogLine(line, batch.deviceId))
      ));
      if (entries.length === 0) {
        return;
      }
      if (state.paused) {
        state = { ...state, pendingEntries: trim([...state.pendingEntries, ...entries]) };
        return;
      }
      state = { ...state, entries: trim([...state.entries, ...entries]) };
    },
    setPaused(paused: boolean) {
      if (state.paused === paused) {
        return;
      }

      if (!paused) {
        state = {
          ...state,
          paused,
          entries: trim([...state.entries, ...state.pendingEntries]),
          pendingEntries: [],
        };
        return;
      }

      state = { ...state, paused };
    },
    clear() {
      state = { ...state, entries: [], pendingEntries: [] };
    },
    setFilter(filter: DeviceLogFilterState) {
      state = { ...state, filter };
    },
  };
}
