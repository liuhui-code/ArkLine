import type {
  DeviceFaultLogEntry,
  DeviceFaultLogFetchResult,
  DeviceFaultLogFilterState,
  DeviceFaultLogParsedResult,
  DeviceFaultLogStoreState,
} from "@/features/device-log/device-fault-log-model";
import { parseDeviceFaultLogEntries } from "@/features/device-log/device-fault-log-parser";

const defaultFilter: DeviceFaultLogFilterState = {
  query: "",
  regex: false,
  matchCase: false,
  type: "all",
  process: "",
  pid: "",
};

export function createDeviceFaultLogStore() {
  let state: DeviceFaultLogStoreState = {
    status: "idle",
    entries: [],
    filter: defaultFilter,
    selectedEntryId: null,
    deviceId: null,
    fetchedAt: null,
    command: "",
    stderr: "",
    message: "",
  };

  return {
    replace(result: DeviceFaultLogFetchResult | DeviceFaultLogParsedResult) {
      const parsed = isParsedResult(result) ? result : parseDeviceFaultLogEntries(result);
      const selectedEntryId = selectEntryId(state.selectedEntryId, parsed.entries);

      state = {
        ...state,
        status: parsed.status,
        entries: parsed.entries,
        selectedEntryId,
        deviceId: parsed.deviceId,
        fetchedAt: parsed.fetchedAt,
        command: parsed.command,
        stderr: parsed.stderr,
        message: parsed.message,
      };
    },
    setFilter(filter: DeviceFaultLogFilterState) {
      state = { ...state, filter };
    },
    selectEntry(selectedEntryId: string | null) {
      state = {
        ...state,
        selectedEntryId: selectedEntryId && state.entries.some((entry) => entry.id === selectedEntryId)
          ? selectedEntryId
          : null,
      };
    },
    clearView() {
      state = {
        ...state,
        status: "idle",
        entries: [],
        selectedEntryId: null,
      };
    },
    getState() {
      return state;
    },
  };
}

function isParsedResult(result: DeviceFaultLogFetchResult | DeviceFaultLogParsedResult): result is DeviceFaultLogParsedResult {
  if (result.entries.length === 0) {
    return false;
  }

  return "rawId" in result.entries[0];
}

function selectEntryId(selectedEntryId: string | null, entries: DeviceFaultLogEntry[]) {
  if (selectedEntryId && entries.some((entry) => entry.id === selectedEntryId)) {
    return selectedEntryId;
  }

  return entries[0]?.id ?? null;
}
