import type { CompiledDeviceLogFilter, DeviceLogEntry, DeviceLogFilterState } from "@/features/device-log/device-log-model";

export function compileDeviceLogFilter(state: DeviceLogFilterState): CompiledDeviceLogFilter {
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

export function applyDeviceLogFilter(entry: DeviceLogEntry, compiled: CompiledDeviceLogFilter): boolean {
  if (!compiled.valid) {
    return false;
  }

  const { state } = compiled;
  if (compiled.queryPattern && !compiled.queryPattern.test(entry.message) && !compiled.queryPattern.test(entry.raw)) {
    return false;
  }

  if (state.levels.length > 0 && !state.levels.includes(entry.level)) {
    return false;
  }

  if (state.pid.trim() && String(entry.pid ?? "") !== state.pid.trim()) {
    return false;
  }

  return includesField(entry.process, state.process, state.matchCase)
    && includesField(entry.domain, state.domain, state.matchCase)
    && includesField(entry.tag, state.tag, state.matchCase);
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
