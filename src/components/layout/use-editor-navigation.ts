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

export type NavigationStatusPrefix = "Back" | "Definition" | "Usage" | "Line";

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
  const navigationHistoryRef = useRef<NavigationLocation[]>([]);
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
    if (!activePath) return;
    const next = {
      path: activePath,
      line: editorSelection.line,
      column: editorSelection.column,
    };
    const previous = navigationHistoryRef.current.at(-1);
    if (
      previous &&
      normalizePath(previous.path) === normalizePath(next.path) &&
      previous.line === next.line &&
      previous.column === next.column
    ) {
      return;
    }
    navigationHistoryRef.current.push(next);
  }

  async function navigateToLocation(
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
        return;
      }
      if (isFailedOpenResult(openResult)) {
        const superseded = openResult.errorMessage === "superseded";
        openPhase.finish(superseded ? "superseded" : "error", openResult.errorMessage);
        if (navigationRequestRef.current === requestId && openResult.errorMessage !== "superseded") {
          onStatusChange(`${statusPrefix} failed: ${getPathBasename(location.path)} ${openResult.errorMessage}`);
        }
        trace.finish(superseded ? "superseded" : "error");
        return;
      }
      openPhase.finish();
    }
    if (navigationRequestRef.current !== requestId) {
      trace.finish("superseded");
      return;
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
  }

  async function navigateBackFromHistory() {
    const target = navigationHistoryRef.current.pop();
    if (!target) {
      onStatusChange("Back: no previous location");
      focusEditorSoon();
      return;
    }
    await navigateToLocation(target, "Back");
  }

  return {
    focusEditor,
    focusEditorSoon,
    isEditorFocused,
    rememberCurrentLocation,
    navigateToLocation,
    navigateBackFromHistory,
  };
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
