import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { createIpcLatencyStore } from "@/features/performance/ipc-latency-store";

const ipcLatencyStore = createIpcLatencyStore();

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await tauriInvoke<T>(command, args);
    ipcLatencyStore.record({ command, durationMs: Date.now() - startedAt, startedAt, status: "ok" });
    return result;
  } catch (error) {
    ipcLatencyStore.record({ command, durationMs: Date.now() - startedAt, startedAt, status: "error" });
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
