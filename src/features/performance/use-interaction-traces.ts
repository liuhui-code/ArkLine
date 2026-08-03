import { useSyncExternalStore } from "react";
import { interactionTraceStore } from "@/features/performance/interaction-trace-store";

export function useInteractionTraces() {
  return useSyncExternalStore(
    interactionTraceStore.subscribe,
    interactionTraceStore.getSnapshot,
    interactionTraceStore.getSnapshot,
  );
}
