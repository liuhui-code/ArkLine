import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createUiLatencyMonitor,
  type UiInteractionKind,
  type UiLatencySample,
} from "@/features/performance/ui-latency-monitor";

export function useUiLatencyMonitor() {
  const monitor = useMemo(() => createUiLatencyMonitor(), []);
  const [samples, setSamples] = useState<UiLatencySample[]>([]);

  const refreshSamples = useCallback(() => {
    const snapshot = monitor.getSnapshot();
    setSamples([...snapshot.eventLoopLags, ...snapshot.interactions].sort((left, right) => (
      right.startedAt - left.startedAt
    )));
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
      const beforeCount = monitor.getSnapshot().eventLoopLags.length;
      monitor.recordHeartbeat(Date.now());
      if (monitor.getSnapshot().eventLoopLags.length !== beforeCount) {
        refreshSamples();
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [monitor, refreshSamples]);

  return { recordUiInteraction, uiLatencySamples: samples };
}
