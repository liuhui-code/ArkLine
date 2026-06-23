import { createSettingsStore } from "@/features/settings/settings-store";

describe("settings store", () => {
  it("starts with readable editor defaults", () => {
    const store = createSettingsStore();

    expect(store.state.settings.editor.fontFamily).toContain("Cascadia");
    expect(store.state.settings.editor.fontSize).toBe(14);
    expect(store.state.settings.editor.lineHeight).toBe(1.65);
    expect(store.state.settings.editor.letterSpacing).toBe(0);
    expect(store.state.settings.sdk.harmonySdkPath).toBe("");
    expect(store.state.settings.sdk.semanticWorkerPath).toBe("");
    expect(store.state.settings.sdk.nodePath).toBe("");
    expect(store.state.settings.sdk.autoDetect).toBe(true);
    expect(store.state.settings.validation.formatOnSave).toBe(true);
    expect(store.state.settings.recentProjects).toEqual([]);
  });

  it("applies partial updates without dropping unrelated settings", () => {
    const store = createSettingsStore();

    store.update({
      editor: {
        fontSize: 14,
        letterSpacing: 0.2,
      },
      sdk: {
        harmonySdkPath: "C:\\HarmonyOS\\Sdk",
        semanticWorkerPath: "C:\\ArkLine\\semantic-worker.mjs",
        nodePath: "C:\\Program Files\\nodejs\\node.exe",
        autoDetect: false,
      },
      recentProjects: ["C:\\HarmonyProjects\\ArkDemo"],
    });

    expect(store.state.settings.editor.fontSize).toBe(14);
    expect(store.state.settings.editor.lineHeight).toBe(1.65);
    expect(store.state.settings.editor.letterSpacing).toBe(0.2);
    expect(store.state.settings.sdk.harmonySdkPath).toBe("C:\\HarmonyOS\\Sdk");
    expect(store.state.settings.sdk.semanticWorkerPath).toBe("C:\\ArkLine\\semantic-worker.mjs");
    expect(store.state.settings.sdk.nodePath).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(store.state.settings.sdk.autoDetect).toBe(false);
    expect(store.state.settings.validation.formatOnSave).toBe(true);
    expect(store.state.settings.recentProjects).toEqual(["C:\\HarmonyProjects\\ArkDemo"]);
  });
});
