import { createSettingsStore } from "@/features/settings/settings-store";

describe("settings store", () => {
  it("starts with readable editor defaults", () => {
    const store = createSettingsStore();

    expect(store.state.settings.editor.fontFamily).toContain("Cascadia");
    expect(store.state.settings.editor.fontSize).toBe(13);
    expect(store.state.settings.validation.formatOnSave).toBe(true);
    expect(store.state.settings.recentProjects).toEqual([]);
  });

  it("applies partial updates without dropping unrelated settings", () => {
    const store = createSettingsStore();

    store.update({
      editor: {
        fontSize: 14,
      },
      recentProjects: ["C:\\HarmonyProjects\\ArkDemo"],
    });

    expect(store.state.settings.editor.fontSize).toBe(14);
    expect(store.state.settings.editor.lineHeight).toBe(1.6);
    expect(store.state.settings.validation.formatOnSave).toBe(true);
    expect(store.state.settings.recentProjects).toEqual(["C:\\HarmonyProjects\\ArkDemo"]);
  });
});
