import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceLogEntry } from "@/features/device-log/device-log-model";
import type { createDeviceLogStore } from "@/features/device-log/device-log-store";

type DeviceLogStore = ReturnType<typeof createDeviceLogStore>;

type DeviceLogLiveBufferOptions = {
  deviceId: string;
  store: DeviceLogStore;
};

const LIVE_BUFFER_FALLBACK_FLUSH_MS = 100;

export function useDeviceLogLiveBuffer({ deviceId, store }: DeviceLogLiveBufferOptions) {
  const [storeVersion, setStoreVersion] = useState(0);
  const [livePaused, setLivePaused] = useState(false);
  const deviceIdRef = useRef(deviceId);
  const frameRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const pendingBatchesRef = useRef<{ deviceId: string; lines: string[] }[]>([]);

  const flushPendingLines = useCallback(() => {
    if (fallbackTimerRef.current != null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = null;
    const batches = pendingBatchesRef.current;
    pendingBatchesRef.current = [];
    const activeDeviceBatches = batches.filter((batch) => batch.deviceId === deviceIdRef.current);

    if (activeDeviceBatches.length > 0) {
      store.appendRawLineBatches(activeDeviceBatches);
      setStoreVersion((value) => value + 1);
    }
  }, [store]);

  const appendLines = useCallback((nextDeviceId: string, lines: string[]) => {
    if (!deviceIdRef.current || nextDeviceId !== deviceIdRef.current) {
      return;
    }

    pendingBatchesRef.current.push({ deviceId: nextDeviceId, lines });
    if (frameRef.current == null) {
      frameRef.current = window.requestAnimationFrame(flushPendingLines);
      fallbackTimerRef.current = window.setTimeout(flushPendingLines, LIVE_BUFFER_FALLBACK_FLUSH_MS);
    }
  }, [flushPendingLines]);

  const pauseLiveView = useCallback(() => {
    store.setPaused(true);
    setLivePaused(true);
    setStoreVersion((value) => value + 1);
  }, [store]);

  const resumeLiveView = useCallback(() => {
    store.setPaused(false);
    setLivePaused(false);
    setStoreVersion((value) => value + 1);
  }, [store]);

  const resetLiveView = useCallback(() => {
    pendingBatchesRef.current = [];
    store.setPaused(false);
    setLivePaused(false);
    setStoreVersion((value) => value + 1);
  }, [store]);

  const refreshLiveView = useCallback(() => {
    setStoreVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    deviceIdRef.current = deviceId;
  }, [deviceId]);

  useEffect(() => () => {
    pendingBatchesRef.current = [];
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (fallbackTimerRef.current != null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const state = store.getState();
  void storeVersion;

  return {
    appendLines,
    entries: state.entries as DeviceLogEntry[],
    livePaused,
    pendingLiveEntries: state.pendingEntries.length,
    refreshLiveView,
    resetLiveView,
    resumeLiveView,
    pauseLiveView,
    storeState: state,
  };
}
