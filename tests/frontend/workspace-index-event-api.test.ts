import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";

const eventListeners = vi.hoisted(() => [] as Array<(event: { payload: unknown }) => void>);
const unlisten = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (): Promise<unknown> => undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_eventName: string, callback: (event: { payload: unknown }) => void) => {
    eventListeners.push(callback);
    return unlisten;
  }),
}));

describe("workspace index event api", () => {
  beforeEach(() => {
    eventListeners.length = 0;
    unlisten.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("subscribes to backend index events and forwards only the active root", async () => {
    const onChange = vi.fn();

    const teardown = await defaultWorkspaceApi.watchWorkspaceIndexEvents?.("C:/samples/DemoWorkspace", onChange);

    expect(eventListeners).toHaveLength(1);
    eventListeners[0]?.({ payload: indexEvent({ rootPath: "C:/samples/OtherWorkspace" }) });
    eventListeners[0]?.({ payload: indexEvent({ rootPath: "C:\\samples\\DemoWorkspace" }) });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: "C:\\samples\\DemoWorkspace",
      phase: "backoff",
    }));

    teardown?.();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

function indexEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "backoff",
    rootPath: "C:/samples/DemoWorkspace",
    scope: "scheduler",
    kind: "refresh-workspace",
    phase: "backoff",
    severity: "warning",
    message: "recommended retry delay 2000ms",
    taskId: "task",
    generation: 1,
    payloadJson: "{}",
    createdAt: 1,
    ...overrides,
  };
}
