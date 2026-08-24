import { useEffect, useRef, type RefObject } from "react";
import type { NavigationLocation } from "@/components/layout/app-shell-types";
import type {
  OpenFileInteractionContext,
  RestoreFileResult,
} from "@/components/layout/use-editor-surface-controller";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";
import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import {
  beginInteractionTrace,
  type InteractionTraceHandle,
} from "@/features/performance/interaction-trace-store";

export type NavigationStatusPrefix = "Back" | "Forward" | "Definition" | "Usage" | "Line";

export type UseEditorNavigationOptions = {
  activePath: string | null;
  editorSelection: { line: number; column: number };
  editorSurfaceRef: RefObject<HTMLElement | null>;
  openFile: (
    path: string,
    interaction?: OpenFileInteractionContext,
  ) => Promise<RestoreFileResult | void>;
  cancelPendingOpen?: () => void;
  setSelectionTarget: (target: { line: number; column: number; nonce: number } | null) => void;
  bumpEditorFocusToken: () => void;
  onStatusChange: (message: string) => void;
  recordUiInteraction?: (kind: UiInteractionKind, label: string, startedAt: number, endedAt: number) => void;
  beginTrace?: typeof beginInteractionTrace;
  scheduleVisibleCommit?: (callback: () => void) => () => void;
};

export function useEditorNavigation({
  activePath,
  editorSelection,
  editorSurfaceRef,
  openFile,
  cancelPendingOpen,
  setSelectionTarget,
  bumpEditorFocusToken,
  onStatusChange,
  recordUiInteraction,
  beginTrace = beginInteractionTrace,
  scheduleVisibleCommit = scheduleAfterStableFrame,
}: UseEditorNavigationOptions) {
  const backHistoryRef = useRef<NavigationLocation[]>([]);
  const forwardHistoryRef = useRef<NavigationLocation[]>([]);
  const pendingOriginRef = useRef<NavigationLocation | null>(null);
  const navigationRequestRef = useRef(0);
  const activeTraceRef = useRef<InteractionTraceHandle | null>(null);
  const cancelVisibleCommitRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    cancelVisibleCommitRef.current?.();
    activeTraceRef.current?.finish("cancelled");
  }, []);

  function focusEditor() {
    const editor = editorSurfaceRef.current?.querySelector<HTMLElement>('[aria-label="Editor Content"]');
    if (editor) {
      editor.focus();
      return;
    }
    editorSurfaceRef.current?.focus();
  }

  function focusEditorSoon() {
    requestAnimationFrame(() => focusEditor());
  }

  function isEditorFocused() {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) {
      return false;
    }

    return activeElement.getAttribute("aria-label") === "Editor Content"
      || !!editorSurfaceRef.current?.contains(activeElement);
  }

  function rememberCurrentLocation() {
    pendingOriginRef.current = currentLocation();
  }

  function commitDirectNavigation(location: NavigationLocation) {
    const origin = pendingOriginRef.current ?? currentLocation();
    pendingOriginRef.current = null;
    if (!origin || sameLocation(origin, location)) return;
    pushDistinct(backHistoryRef.current, origin);
    forwardHistoryRef.current = [];
  }

  function currentLocation(): NavigationLocation | null {
    if (!activePath) return null;
    return {
      path: activePath,
      line: editorSelection.line,
      column: editorSelection.column,
    };
  }

  async function performNavigation(
    location: NavigationLocation,
    statusPrefix: NavigationStatusPrefix = "Definition",
  ) {
    const startedAt = Date.now();
    const requestId = navigationRequestRef.current + 1;
    navigationRequestRef.current = requestId;
    cancelVisibleCommitRef.current?.();
    activeTraceRef.current?.finish("superseded");
    const targetName = getPathBasename(location.path);
    const trace = beginTrace("navigation", targetName, requestId, {
      attributes: { path: location.path, line: location.line, column: location.column, source: statusPrefix },
    });
    activeTraceRef.current = trace;
    cancelPendingOpen?.();
    if (normalizePath(location.path) !== normalizePath(activePath ?? "")) {
      const openPhase = trace.startPhase("openFile");
      let openResult: RestoreFileResult | void;
      try {
        openResult = await openFile(location.path, { parentInteractionId: trace.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        openPhase.finish("error", message);
        if (navigationRequestRef.current === requestId) {
          onStatusChange(`${statusPrefix} failed: ${targetName} ${message}`);
        }
        trace.finish("error");
        return false;
      }
      if (isFailedOpenResult(openResult)) {
        const superseded = openResult.errorMessage === "superseded";
        openPhase.finish(superseded ? "superseded" : "error", openResult.errorMessage);
        if (navigationRequestRef.current === requestId && openResult.errorMessage !== "superseded") {
          onStatusChange(`${statusPrefix} failed: ${getPathBasename(location.path)} ${openResult.errorMessage}`);
        }
        trace.finish(superseded ? "superseded" : "error");
        return false;
      }
      openPhase.finish();
    }
    if (navigationRequestRef.current !== requestId) {
      trace.finish("superseded");
      return false;
    }
    const selectionPhase = trace.startPhase("applySelection");
    setSelectionTarget({
      line: location.line,
      column: location.column,
      nonce: Date.now(),
    });
    bumpEditorFocusToken();
    selectionPhase.finish();
    onStatusChange(`${statusPrefix}: ${getPathBasename(location.path)}:${location.line}:${location.column}`);
    focusEditorSoon();
    const visiblePhase = trace.startPhase("visibleCommit");
    cancelVisibleCommitRef.current = scheduleVisibleCommit(() => {
      visiblePhase.finish();
      trace.finish("ok");
      if (activeTraceRef.current === trace) activeTraceRef.current = null;
      cancelVisibleCommitRef.current = null;
      recordUiInteraction?.(
        statusPrefix === "Definition" ? "goToDefinition" : "openFile",
        targetName,
        startedAt,
        Date.now(),
      );
    });
    return true;
  }

  async function navigateToLocation(
    location: NavigationLocation,
    statusPrefix: NavigationStatusPrefix = "Definition",
  ) {
    const origin = pendingOriginRef.current ?? currentLocation();
    pendingOriginRef.current = null;
    const navigated = await performNavigation(location, statusPrefix);
    if (!navigated || !origin || sameLocation(origin, location)) return;
    pushDistinct(backHistoryRef.current, origin);
    forwardHistoryRef.current = [];
  }

  async function navigateBackFromHistory() {
    pendingOriginRef.current = null;
    const target = backHistoryRef.current.pop();
    if (!target) {
      onStatusChange("Back: no previous location");
      focusEditorSoon();
      return;
    }
    const origin = currentLocation();
    if (await performNavigation(target, "Back")) {
      if (origin && !sameLocation(origin, target)) pushDistinct(forwardHistoryRef.current, origin);
      return;
    }
    pushDistinct(backHistoryRef.current, target);
  }

  async function navigateForwardFromHistory() {
    pendingOriginRef.current = null;
    const target = forwardHistoryRef.current.pop();
    if (!target) {
      onStatusChange("Forward: no next location");
      focusEditorSoon();
      return;
    }
    const origin = currentLocation();
    if (await performNavigation(target, "Forward")) {
      if (origin && !sameLocation(origin, target)) pushDistinct(backHistoryRef.current, origin);
      return;
    }
    pushDistinct(forwardHistoryRef.current, target);
  }

  return {
    focusEditor,
    focusEditorSoon,
    isEditorFocused,
    rememberCurrentLocation,
    commitDirectNavigation,
    navigateToLocation,
    navigateBackFromHistory,
    navigateForwardFromHistory,
  };
}

function sameLocation(left: NavigationLocation, right: NavigationLocation) {
  return normalizePath(left.path) === normalizePath(right.path)
    && left.line === right.line
    && left.column === right.column;
}

function pushDistinct(history: NavigationLocation[], location: NavigationLocation) {
  const previous = history.at(-1);
  if (!previous || !sameLocation(previous, location)) history.push(location);
}

function scheduleAfterStableFrame(callback: () => void) {
  let secondFrame: number | null = null;
  const firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(callback);
  });
  return () => {
    cancelAnimationFrame(firstFrame);
    if (secondFrame != null) cancelAnimationFrame(secondFrame);
  };
}

function isFailedOpenResult(result: RestoreFileResult | void): result is RestoreFileResult {
  return result !== undefined && !result.ok;
}
