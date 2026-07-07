import { useRef, type RefObject } from "react";
import type { NavigationLocation } from "@/components/layout/app-shell-types";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

export type UseEditorNavigationOptions = {
  activePath: string | null;
  editorSelection: { line: number; column: number };
  editorSurfaceRef: RefObject<HTMLElement | null>;
  openFile: (path: string) => Promise<void>;
  setSelectionTarget: (target: { line: number; column: number; nonce: number } | null) => void;
  bumpEditorFocusToken: () => void;
  onStatusChange: (message: string) => void;
};

export function useEditorNavigation({
  activePath,
  editorSelection,
  editorSurfaceRef,
  openFile,
  setSelectionTarget,
  bumpEditorFocusToken,
  onStatusChange,
}: UseEditorNavigationOptions) {
  const navigationHistoryRef = useRef<NavigationLocation[]>([]);
  const navigationRequestRef = useRef(0);

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
    statusPrefix: "Back" | "Definition" | "Usage" | "Line" = "Definition",
  ) {
    const requestId = navigationRequestRef.current + 1;
    navigationRequestRef.current = requestId;
    if (normalizePath(location.path) !== normalizePath(activePath ?? "")) {
      await openFile(location.path);
    }
    if (navigationRequestRef.current !== requestId) {
      return;
    }
    setSelectionTarget({
      line: location.line,
      column: location.column,
      nonce: Date.now(),
    });
    bumpEditorFocusToken();
    onStatusChange(`${statusPrefix}: ${getPathBasename(location.path)}:${location.line}:${location.column}`);
    focusEditorSoon();
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
