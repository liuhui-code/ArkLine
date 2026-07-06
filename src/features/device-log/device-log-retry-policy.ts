export const DEFAULT_DEVICE_LOG_RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;

export type DeviceLogRetryState = {
  attempts: number;
};

export type DeviceLogRetryDecision = {
  delayMs: number | null;
  attempt: number;
  exhausted: boolean;
  state: DeviceLogRetryState;
};

export function createDeviceLogRetryState(): DeviceLogRetryState {
  return { attempts: 0 };
}

export function resetDeviceLogRetry(_state: DeviceLogRetryState): DeviceLogRetryState {
  return createDeviceLogRetryState();
}

export function nextDeviceLogRetry(
  state: DeviceLogRetryState,
  retryDelaysMs: readonly number[] = DEFAULT_DEVICE_LOG_RETRY_DELAYS_MS,
): DeviceLogRetryDecision {
  const delayMs = retryDelaysMs[state.attempts] ?? null;
  if (delayMs == null) {
    return {
      delayMs,
      attempt: state.attempts,
      exhausted: true,
      state,
    };
  }

  const nextState = { attempts: state.attempts + 1 };
  return {
    delayMs,
    attempt: nextState.attempts,
    exhausted: false,
    state: nextState,
  };
}
