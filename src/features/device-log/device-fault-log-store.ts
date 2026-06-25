import type {
  DeviceFaultLogFetchResult,
  DeviceFaultLogFilterState,
  DeviceFaultLogStoreState,
} from "@/features/device-log/device-fault-log-model";
import { parseDeviceFaultLogEntries } from "@/features/device-log/device-fault-log-parser";

const defaultFilter: DeviceFaultLogFilterState = {
  query: "",
  regex: false,
  matchCase: false,
  types: [],
  process: "",
  pid: "",
};

export function createDeviceFaultLogStore() {
  let state: DeviceFaultLogStoreState = {
    status: "idle",
    error: null,
    entries: [],
    filter: defaultFilter,
    selectedEntryId: null,
  };

  return {
    replace(result: DeviceFaultLogFetchResult) {
      const entries = parseDeviceFaultLogEntries(result);
      const selectedEntryId = entries.some((entry) => entry.id === state.selectedEntryId)
        ? state.selectedEntryId
        : (entries[0]?.id ?? null);

      state = {
        ...state,
        status: result.status,
        error: result.error,
        entries,
        selectedEntryId,
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
        error: null,
        entries: [],
        selectedEntryId: null,
      };
    },
    getState() {
      return state;
    },
  };
}
