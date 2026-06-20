export type AppSettings = {
  editor: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
  };
  validation: {
    formatOnSave: boolean;
    lintCommand: string;
    formatCommand: string;
    timeoutMs: number;
  };
  recentProjects: string[];
};

export type AppSettingsPatch = {
  editor?: Partial<AppSettings["editor"]>;
  validation?: Partial<AppSettings["validation"]>;
  recentProjects?: string[];
};

export function defaultSettings(): AppSettings {
  return {
    editor: {
      fontFamily: "Cascadia Code, JetBrains Mono, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.6,
    },
    validation: {
      formatOnSave: true,
      lintCommand: "arklint",
      formatCommand: "arkfmt",
      timeoutMs: 5000,
    },
    recentProjects: [],
  };
}

function mergeSettings(current: AppSettings, update: AppSettingsPatch): AppSettings {
  return {
    editor: {
      ...current.editor,
      ...update.editor,
    },
    validation: {
      ...current.validation,
      ...update.validation,
    },
    recentProjects: update.recentProjects ?? current.recentProjects,
  };
}

export function createSettingsStore(initial = defaultSettings()) {
  const state = {
    settings: initial,
  };

  return {
    state,
    update(update: AppSettingsPatch) {
      state.settings = mergeSettings(state.settings, update);
    },
    replace(next: AppSettings) {
      state.settings = next;
    },
  };
}
