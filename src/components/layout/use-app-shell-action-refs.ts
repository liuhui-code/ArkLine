import { useRef } from "react";
import type { AppSettings } from "@/features/settings/settings-store";

type AppShellActionRefs = {
  completionActionsRef: {
    current: {
      clearCompletionSession: () => void;
      clearTypingCompletionTimer: () => void;
    };
  };
  searchActionsRef: {
    current: { resetSearchOverlayState: () => void };
  };
  settingsActionsRef: {
    current: { indexSdkSymbolsForSettings: (settings: AppSettings) => Promise<void> };
  };
  gitActionsRef: {
    current: { refreshGitBlame: () => void };
  };
  editorActionsRef: {
    current: { openFile: (path: string) => Promise<void> };
  };
  workspaceOpeningActionsRef: {
    current: { openWorkspace: (rootPath: string) => Promise<void> };
  };
  projectOpeningActionsRef: {
    current: {
      setProjectPathInput: (rootPath: string) => void;
      setProjectOpenError: (message: string | null) => void;
    };
  };
};

export function useAppShellActionRefs() {
  const refs = useRef<AppShellActionRefs>({
    completionActionsRef: {
      current: {
        clearCompletionSession: () => undefined,
        clearTypingCompletionTimer: () => undefined,
      },
    },
    searchActionsRef: {
      current: { resetSearchOverlayState: () => undefined },
    },
    settingsActionsRef: {
      current: {
        indexSdkSymbolsForSettings: async (_settings: AppSettings) => undefined,
      },
    },
    gitActionsRef: {
      current: { refreshGitBlame: () => undefined },
    },
    editorActionsRef: {
      current: { openFile: async (_path: string) => undefined },
    },
    workspaceOpeningActionsRef: {
      current: { openWorkspace: async (_rootPath: string) => undefined },
    },
    projectOpeningActionsRef: {
      current: {
        setProjectPathInput: (_rootPath: string) => undefined,
        setProjectOpenError: (_message: string | null) => undefined,
      },
    },
  });

  return refs.current;
}
