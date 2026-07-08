import type { EditorInsertTextTarget, EditorSelectionTarget } from "@/components/layout/EditorSurface";
import { useEffect, useMemo, useRef } from "react";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  appearanceCompartment,
  appearanceExtensionForSettings,
  createEditorExtensions,
  editorStructureCompartment,
  gitTraceCompartment,
  languageCompartment,
  languageExtensionForPath,
  structureExtensionForDocument,
} from "@/editor/editor-extensions";
import {
  readCaretRect,
  resolveDefinitionTokenRange,
  setJumpRevealEffect,
  type DefinitionHoverState,
  type EditorCaretRect,
  type EditorContextMenuRequest,
  type EditorLineColumn,
} from "@/editor/editor-events";
import { isLargeEditorDocument } from "@/editor/editor-document-budget";
import { createGitTraceGutter } from "@/editor/git-trace-decorations";
import type { GitBlameAttribution } from "@/features/git/git-trace-model";
import type { EditorAppearance } from "@/types/editor";

type ArkTsEditorProps = {
  focusToken?: number;
  path: string;
  value: string;
  appearance: EditorAppearance;
  selectionTarget?: EditorSelectionTarget | null;
  insertTextTarget?: EditorInsertTextTarget | null;
  onChange: (value: string) => void;
  onSelectionChange?: (selection: { line: number; column: number; selectedText?: string }) => void;
  onCaretRectChange?: (rect: EditorCaretRect) => void;
  onDefinitionTrigger?: (selection?: EditorLineColumn) => void;
  onDefinitionHoverChange?: (state: DefinitionHoverState) => void;
  onTypingCompletionTrigger?: (selection: EditorLineColumn) => void;
  onContextMenu?: (request: EditorContextMenuRequest) => void;
  blameAttributions?: GitBlameAttribution[];
  gitBlameVisible?: boolean;
  selectedBlameLine?: number | null;
  onGitTraceLineClick?: (line: number) => void;
};

export function ArkTsEditor({
  focusToken = 0,
  path,
  value,
  appearance,
  selectionTarget = null,
  insertTextTarget = null,
  onChange,
  onSelectionChange,
  onCaretRectChange,
  onDefinitionTrigger,
  onDefinitionHoverChange,
  onTypingCompletionTrigger,
  onContextMenu,
  blameAttributions = [],
  gitBlameVisible = false,
  selectedBlameLine = null,
  onGitTraceLineClick,
}: ArkTsEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onCaretRectChangeRef = useRef(onCaretRectChange);
  const onDefinitionTriggerRef = useRef(onDefinitionTrigger);
  const onDefinitionHoverChangeRef = useRef(onDefinitionHoverChange);
  const onTypingCompletionTriggerRef = useRef(onTypingCompletionTrigger);
  const onContextMenuRef = useRef(onContextMenu);
  const jumpRevealTimeoutRef = useRef<number | null>(null);
  const largeDocumentMode = useMemo(() => isLargeEditorDocument(value), [value]);

  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;
  onCaretRectChangeRef.current = onCaretRectChange;
  onDefinitionTriggerRef.current = onDefinitionTrigger;
  onDefinitionHoverChangeRef.current = onDefinitionHoverChange;
  onTypingCompletionTriggerRef.current = onTypingCompletionTrigger;
  onContextMenuRef.current = onContextMenu;

  useEffect(() => {
    if (!hostRef.current || viewRef.current) {
      return;
    }

    const state = EditorState.create({
      doc: value,
      extensions: createEditorExtensions(
        path,
        appearance,
        (nextValue) => onChangeRef.current(nextValue),
        (selection) => {
          onSelectionChangeRef.current?.(selection);
          const view = viewRef.current;
          if (view) {
            onCaretRectChangeRef.current?.(readCaretRect(view));
          }
        },
        (selection) => onDefinitionTriggerRef.current?.(selection),
        (state) => onDefinitionHoverChangeRef.current?.(state),
        (selection) => onTypingCompletionTriggerRef.current?.(selection),
        (request) => onContextMenuRef.current?.(request),
        gitBlameVisible
          ? {
              blameAttributions,
              selectedLine: selectedBlameLine,
              onSelectLine: onGitTraceLineClick,
            }
          : undefined,
        largeDocumentMode,
      ),
    });

    viewRef.current = new EditorView({
      state,
      parent: hostRef.current,
    });
    onCaretRectChangeRef.current?.(readCaretRect(viewRef.current));

    return () => {
      if (jumpRevealTimeoutRef.current != null) {
        window.clearTimeout(jumpRevealTimeoutRef.current);
      }
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue !== value) {
      const selection = view.state.selection.main;
      const anchor = Math.min(selection.anchor, value.length);
      const head = Math.min(selection.head, value.length);

      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
        selection: EditorSelection.range(anchor, head),
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: [
        editorStructureCompartment.reconfigure(structureExtensionForDocument(largeDocumentMode)),
        languageCompartment.reconfigure(languageExtensionForPath(path, largeDocumentMode)),
      ],
    });
  }, [largeDocumentMode, path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: appearanceCompartment.reconfigure(appearanceExtensionForSettings(appearance)),
    });
  }, [appearance, path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: gitTraceCompartment.reconfigure(
        gitBlameVisible && !largeDocumentMode
          ? createGitTraceGutter({
              blameAttributions,
              selectedLine: selectedBlameLine,
              onSelectLine: onGitTraceLineClick,
            })
          : [],
      ),
    });
  }, [blameAttributions, gitBlameVisible, largeDocumentMode, onGitTraceLineClick, selectedBlameLine]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !selectionTarget) {
      return;
    }

    const targetLineInput = Number.isFinite(selectionTarget.line) ? selectionTarget.line : 1;
    const targetColumnInput = Number.isFinite(selectionTarget.column) ? selectionTarget.column : 1;
    const targetLine = Math.min(Math.max(targetLineInput, 1), view.state.doc.lines);
    const line = view.state.doc.line(targetLine);
    const targetColumn = Math.max(targetColumnInput, 1);
    const position = Math.min(line.from + targetColumn - 1, line.to);
    const revealRange = resolveDefinitionTokenRange(view, position);

    view.dispatch({
      selection: EditorSelection.cursor(position),
      effects: [
        EditorView.scrollIntoView(position, { y: "center" }),
        setJumpRevealEffect.of(revealRange),
      ],
    });
    view.focus();

    if (jumpRevealTimeoutRef.current != null) {
      window.clearTimeout(jumpRevealTimeoutRef.current);
    }

    jumpRevealTimeoutRef.current = window.setTimeout(() => {
      const currentView = viewRef.current;
      if (!currentView) {
        return;
      }

      currentView.dispatch({
        effects: setJumpRevealEffect.of(null),
      });
      jumpRevealTimeoutRef.current = null;
    }, 1200);
  }, [selectionTarget]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !insertTextTarget) {
      return;
    }

    const selection = view.state.selection.main;
    const replaceBefore = Math.max(insertTextTarget.replaceBefore ?? 0, 0);
    const from = Math.max(0, selection.head - replaceBefore);

    view.dispatch({
      changes: {
        from,
        to: selection.head,
        insert: insertTextTarget.text,
      },
      selection: EditorSelection.cursor(from + insertTextTarget.text.length),
    });
    view.focus();
  }, [insertTextTarget]);

  useEffect(() => {
    viewRef.current?.focus();
  }, [focusToken]);

  return <div className="editor-codemirror" ref={hostRef} />;
}
