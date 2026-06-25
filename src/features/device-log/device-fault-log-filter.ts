import type {
  CompiledDeviceFaultLogFilter,
  DeviceFaultLogEntry,
  DeviceFaultLogFilterState,
} from "@/features/device-log/device-fault-log-model";

export function compileDeviceFaultLogFilter(state: DeviceFaultLogFilterState): CompiledDeviceFaultLogFilter {
  const query = state.query.trim();
  if (!query) {
    return { valid: true, error: null, state, queryPattern: null };
  }

  try {
    const source = state.regex ? query : escapeRegExp(query);
    return {
      valid: true,
      error: null,
      state,
      queryPattern: new RegExp(source, state.matchCase ? "u" : "iu"),
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid regular expression",
      state,
      queryPattern: null,
    };
  }
}

export function applyDeviceFaultLogFilter(entry: DeviceFaultLogEntry, compiled: CompiledDeviceFaultLogFilter): boolean {
  if (!compiled.valid) {
    return false;
  }

  const { state } = compiled;
  if (compiled.queryPattern && !compiled.queryPattern.test(entry.summary) && !compiled.queryPattern.test(entry.raw)) {
    return false;
  }

  if (state.type !== "all" && entry.type !== state.type) {
    return false;
  }

  if (state.pid.trim() && String(entry.pid ?? "") !== state.pid.trim()) {
    return false;
  }

  return includesField(entry.processName, state.process, state.matchCase);
}

function includesField(value: string, query: string, matchCase: boolean) {
  const trimmed = query.trim();
  if (!trimmed) {
    return true;
  }

  return matchCase
    ? value.includes(trimmed)
    : value.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase());
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
