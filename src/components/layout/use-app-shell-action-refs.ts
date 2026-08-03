import { useRef } from "react";
import type {
  OpenFileInteractionContext,
  RestoreFileResult,
} from "@/components/layout/use-editor-surface-controller";
import type { AppSettings } from "@/features/settings/settings-store";

type AppShellActionRefs = {
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
    current: {
      openFile: (
        path: string,
        interaction?: OpenFileInteractionContext,
      ) => Promise<RestoreFileResult | void>;
      cancelPendingOpen: () => void;
    };
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
      current: {
        openFile: async (_path: string) => undefined,
        cancelPendingOpen: () => undefined,
      },
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
