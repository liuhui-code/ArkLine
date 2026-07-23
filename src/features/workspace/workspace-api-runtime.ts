import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { createIpcLatencyStore } from "@/features/performance/ipc-latency-store";

const ipcLatencyStore = createIpcLatencyStore();

declare global {
  interface Window {
    __arklineIpcLatencySamples?: ReturnType<typeof ipcLatencyStore.snapshot>;
  }
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await tauriInvoke<T>(command, args);
    recordIpcLatency(command, startedAt, "ok");
    return result;
  } catch (error) {
    recordIpcLatency(command, startedAt, "error");
    throw error;
  }
}

export function getIpcLatencySnapshot() {
  return ipcLatencyStore.snapshot();
}

export { listen, open, save };

export function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function recordIpcLatency(
  command: string,
  startedAt: number,
  status: "ok" | "error",
) {
  ipcLatencyStore.record({
    command,
    durationMs: Date.now() - startedAt,
    startedAt,
    status,
  });
  if (typeof window !== "undefined") {
    window.__arklineIpcLatencySamples = ipcLatencyStore.snapshot();
  }
}
