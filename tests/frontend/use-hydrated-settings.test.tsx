import { renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { useHydratedSettings } from "@/components/layout/use-hydrated-settings";
import { createSettingsStore, defaultSettings } from "@/features/settings/settings-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

describe("useHydratedSettings", () => {
  it("does not reload settings when only the hydration callback identity changes", async () => {
    const loadSettings = vi.fn(async () => defaultSettings());
    const workspaceApi = { loadSettings } as unknown as WorkspaceApi;
    const settingsRef = { current: createSettingsStore() };
    const firstHydrated = vi.fn();
    const secondHydrated = vi.fn();
    const { rerender } = renderHook(
      ({ onHydrated }) => useHydratedSettings({ workspaceApi, settingsRef, onHydrated }),
      { initialProps: { onHydrated: firstHydrated } },
    );

    await vi.waitFor(() => expect(firstHydrated).toHaveBeenCalledTimes(1));
    rerender({ onHydrated: secondHydrated });
    await Promise.resolve();

    expect(loadSettings).toHaveBeenCalledTimes(1);
    expect(secondHydrated).not.toHaveBeenCalled();
  });

  it("delivers an in-flight load to the latest callback", async () => {
    let resolveSettings: ((settings: ReturnType<typeof defaultSettings>) => void) | undefined;
    const workspaceApi = {
      loadSettings: vi.fn(() => new Promise<ReturnType<typeof defaultSettings>>((resolve) => {
        resolveSettings = resolve;
      })),
    } as unknown as WorkspaceApi;
    const settingsRef = { current: createSettingsStore() };
    const firstHydrated = vi.fn();
    const secondHydrated = vi.fn();
    const { rerender } = renderHook(
      ({ onHydrated }) => useHydratedSettings({ workspaceApi, settingsRef, onHydrated }),
      { initialProps: { onHydrated: firstHydrated } },
    );

    rerender({ onHydrated: secondHydrated });
    resolveSettings?.(defaultSettings());

    await vi.waitFor(() => expect(secondHydrated).toHaveBeenCalledTimes(1));
    expect(firstHydrated).not.toHaveBeenCalled();
    expect(workspaceApi.loadSettings).toHaveBeenCalledTimes(1);
  });
});
