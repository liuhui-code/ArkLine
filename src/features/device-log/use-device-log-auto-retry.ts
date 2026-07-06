import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDeviceLogRetryState,
  nextDeviceLogRetry,
  resetDeviceLogRetry,
  type DeviceLogRetryState,
} from "@/features/device-log/device-log-retry-policy";

const RETRY_TICK_MS = 1_000;

type UseDeviceLogAutoRetryOptions = {
  deviceId: string;
  retryDelaysMs?: readonly number[];
  onExhausted: () => void;
  onRetry: () => void;
};

export function useDeviceLogAutoRetry({
  deviceId,
  retryDelaysMs,
  onExhausted,
  onRetry,
}: UseDeviceLogAutoRetryOptions) {
  const [autoRetryExhausted, setAutoRetryExhausted] = useState(false);
  const [autoRetryMs, setAutoRetryMs] = useState<number | null>(null);
  const [autoRetryPaused, setAutoRetryPaused] = useState(false);
  const onExhaustedRef = useRef(onExhausted);
  const onRetryRef = useRef(onRetry);
  const pausedRef = useRef(false);
  const retryStateRef = useRef<DeviceLogRetryState>(createDeviceLogRetryState());
  const retryTimerRef = useRef<number | null>(null);
  const retryTickRef = useRef<number | null>(null);

  useEffect(() => {
    onExhaustedRef.current = onExhausted;
    onRetryRef.current = onRetry;
  }, [onExhausted, onRetry]);

  const clearAutoRetry = useCallback(() => {
    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (retryTickRef.current != null) {
      window.clearInterval(retryTickRef.current);
      retryTickRef.current = null;
    }
    setAutoRetryMs(null);
  }, []);

  const resetRetryBudget = useCallback(() => {
    retryStateRef.current = createDeviceLogRetryState();
    setAutoRetryExhausted(false);
    pausedRef.current = false;
    setAutoRetryPaused(false);
    clearAutoRetry();
  }, [clearAutoRetry]);

  const markHealthy = useCallback(() => {
    retryStateRef.current = resetDeviceLogRetry(retryStateRef.current);
    setAutoRetryExhausted(false);
    pausedRef.current = false;
    setAutoRetryPaused(false);
  }, []);

  const pauseAutoRetry = useCallback(() => {
    pausedRef.current = true;
    setAutoRetryPaused(true);
    clearAutoRetry();
  }, [clearAutoRetry]);

  const resumeAutoRetry = useCallback(() => {
    pausedRef.current = false;
    setAutoRetryPaused(false);
  }, []);

  const scheduleAutoRetry = useCallback(() => {
    if (pausedRef.current || retryTimerRef.current != null || !deviceId) {
      return;
    }
    const retry = nextDeviceLogRetry(retryStateRef.current, retryDelaysMs);
    retryStateRef.current = retry.state;
    if (retry.exhausted || retry.delayMs == null) {
      setAutoRetryExhausted(true);
      onExhaustedRef.current();
      return;
    }

    setAutoRetryExhausted(false);
    setAutoRetryMs(retry.delayMs);
    retryTickRef.current = window.setInterval(() => {
      setAutoRetryMs((value) => (value == null ? null : Math.max(0, value - RETRY_TICK_MS)));
    }, RETRY_TICK_MS);
    retryTimerRef.current = window.setTimeout(() => {
      clearAutoRetry();
      onRetryRef.current();
    }, retry.delayMs);
  }, [clearAutoRetry, deviceId, retryDelaysMs]);

  useEffect(() => clearAutoRetry, [clearAutoRetry]);

  return {
    autoRetryExhausted,
    autoRetryMs,
    autoRetryPaused,
    clearAutoRetry,
    markHealthy,
    pauseAutoRetry,
    resetRetryBudget,
    resumeAutoRetry,
    scheduleAutoRetry,
  };
}
