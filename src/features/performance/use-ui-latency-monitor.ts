import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createUiLatencyMonitor,
  type UiInteractionKind,
  type UiLatencySample,
} from "@/features/performance/ui-latency-monitor";
import { createRenderPressureStore, type RenderPressureSample } from "@/features/performance/render-pressure-store";
import { getIpcLatencySnapshot } from "@/features/workspace/workspace-api-runtime";

const renderPressureStore = createRenderPressureStore();

export function recordRenderPressure(label: string) {
  renderPressureStore.record(label);
}

export function useUiLatencyMonitor() {
  const monitor = useMemo(() => createUiLatencyMonitor(), []);
  const [samples, setSamples] = useState<UiLatencySample[]>([]);
  const [renderPressureSamples, setRenderPressureSamples] = useState<RenderPressureSample[]>([]);
  const [ipcLatencySamples, setIpcLatencySamples] = useState(getIpcLatencySnapshot);

  const refreshSamples = useCallback(() => {
    const snapshot = monitor.getSnapshot();
    setSamples([...snapshot.eventLoopLags, ...snapshot.interactions].sort((left, right) => (
      right.startedAt - left.startedAt
    )));
    setRenderPressureSamples(renderPressureStore.snapshot());
    setIpcLatencySamples(getIpcLatencySnapshot());
  }, [monitor]);

  const recordUiInteraction = useCallback((
    kind: UiInteractionKind,
    label: string,
    startedAt: number,
    endedAt: number,
  ) => {
    monitor.recordInteraction(kind, label, startedAt, endedAt);
    refreshSamples();
  }, [monitor, refreshSamples]);

  useEffect(() => {
    monitor.recordHeartbeat(Date.now());
    const timer = window.setInterval(() => {
      monitor.recordHeartbeat(Date.now());
    }, 50);
    return () => window.clearInterval(timer);
  }, [monitor]);

  return { recordUiInteraction, uiLatencySamples: samples, renderPressureSamples, ipcLatencySamples };
}
