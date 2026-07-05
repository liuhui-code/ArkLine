export type AppSettings = {
  editor: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
  };
  sdk: {
    harmonySdkPath: string;
    semanticWorkerPath: string;
    nodePath: string;
    autoDetect: boolean;
  };
  validation: {
    formatOnSave: boolean;
    lintCommand: string;
    formatCommand: string;
    timeoutMs: number;
  };
  recentProjects: string[];
  workspaceSessions: Record<string, { activeFilePath?: string }>;
};

export type AppSettingsPatch = {
  editor?: Partial<AppSettings["editor"]>;
  sdk?: Partial<AppSettings["sdk"]>;
  validation?: Partial<AppSettings["validation"]>;
  recentProjects?: string[];
  workspaceSessions?: AppSettings["workspaceSessions"];
};

export function defaultSettings(): AppSettings {
  return {
    editor: {
      fontFamily: "Cascadia Code, JetBrains Mono, Consolas, monospace",
      fontSize: 14,
      lineHeight: 1.65,
      letterSpacing: 0,
    },
    sdk: {
      harmonySdkPath: "",
      semanticWorkerPath: "",
      nodePath: "",
      autoDetect: true,
    },
    validation: {
      formatOnSave: true,
      lintCommand: "arklint",
      formatCommand: "arkfmt",
      timeoutMs: 5000,
    },
    recentProjects: [],
    workspaceSessions: {},
  };
}

function mergeSettings(current: AppSettings, update: AppSettingsPatch): AppSettings {
  return {
    editor: {
      ...current.editor,
      ...update.editor,
    },
    sdk: {
      ...current.sdk,
      ...update.sdk,
    },
    validation: {
      ...current.validation,
      ...update.validation,
    },
    recentProjects: update.recentProjects ?? current.recentProjects,
    workspaceSessions: update.workspaceSessions ?? current.workspaceSessions,
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
