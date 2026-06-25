import type {
  CompiledDeviceFaultLogFilter,
  DeviceFaultLogFilterState,
  DeviceFaultLogParsedEntry,
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
    const message = error instanceof Error ? error.message : "Invalid regular expression";
    return {
      valid: false,
      error: message.startsWith("Invalid regular expression") ? message : `Invalid regular expression: ${message}`,
      state,
      queryPattern: null,
    };
  }
}

export function applyDeviceFaultLogFilter(entry: DeviceFaultLogParsedEntry, compiled: CompiledDeviceFaultLogFilter): boolean {
  if (!compiled.valid) {
    return false;
  }

  const { state } = compiled;
  if (compiled.queryPattern && !matchesQuery(entry, compiled.queryPattern)) {
    return false;
  }

  if (state.types.length > 0 && !state.types.includes(entry.type)) {
    return false;
  }

  if (state.pid.trim() && String(entry.pid ?? "") !== state.pid.trim()) {
    return false;
  }

  return includesField(entry.process, state.process, state.matchCase);
}

function matchesQuery(entry: DeviceFaultLogParsedEntry, queryPattern: RegExp) {
  return queryPattern.test(entry.summary)
    || queryPattern.test(entry.error)
    || queryPattern.test(entry.rawText);
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
