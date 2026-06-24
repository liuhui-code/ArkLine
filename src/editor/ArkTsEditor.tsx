import type { EditorInsertTextTarget, EditorSelectionTarget } from "@/components/layout/EditorSurface";
import { useEffect, useRef } from "react";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  appearanceCompartment,
  appearanceExtensionForSettings,
  createEditorExtensions,
  gitTraceCompartment,
  languageCompartment,
  languageExtensionForPath,
} from "@/editor/editor-extensions";
import {
  resolveDefinitionTokenRange,
  setJumpRevealEffect,
  type DefinitionHoverState,
  type EditorLineColumn,
} from "@/editor/editor-events";
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
  onSelectionChange?: (selection: { line: number; column: number }) => void;
  onDefinitionTrigger?: (selection?: EditorLineColumn) => void;
  onDefinitionHoverChange?: (state: DefinitionHoverState) => void;
  onTypingCompletionTrigger?: (selection: EditorLineColumn) => void;
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
  onDefinitionTrigger,
  onDefinitionHoverChange,
  onTypingCompletionTrigger,
  blameAttributions = [],
  gitBlameVisible = false,
  selectedBlameLine = null,
  onGitTraceLineClick,
}: ArkTsEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onDefinitionTriggerRef = useRef(onDefinitionTrigger);
  const onDefinitionHoverChangeRef = useRef(onDefinitionHoverChange);
  const onTypingCompletionTriggerRef = useRef(onTypingCompletionTrigger);
  const jumpRevealTimeoutRef = useRef<number | null>(null);

  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;
  onDefinitionTriggerRef.current = onDefinitionTrigger;
  onDefinitionHoverChangeRef.current = onDefinitionHoverChange;
  onTypingCompletionTriggerRef.current = onTypingCompletionTrigger;

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
        (selection) => onSelectionChangeRef.current?.(selection),
        (selection) => onDefinitionTriggerRef.current?.(selection),
        (state) => onDefinitionHoverChangeRef.current?.(state),
        (selection) => onTypingCompletionTriggerRef.current?.(selection),
        {
          blameAttributions: gitBlameVisible ? blameAttributions : [],
          selectedLine: selectedBlameLine,
          onSelectLine: onGitTraceLineClick,
        },
      ),
    });

    viewRef.current = new EditorView({
      state,
      parent: hostRef.current,
    });

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
      effects: languageCompartment.reconfigure(languageExtensionForPath(path)),
    });
  }, [path]);

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
        createGitTraceGutter({
          blameAttributions: gitBlameVisible ? blameAttributions : [],
          selectedLine: selectedBlameLine,
          onSelectLine: onGitTraceLineClick,
        }),
      ),
    });
  }, [blameAttributions, gitBlameVisible, onGitTraceLineClick, selectedBlameLine]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !selectionTarget) {
      return;
    }

    const targetLine = Math.min(Math.max(selectionTarget.line, 1), view.state.doc.lines);
    const line = view.state.doc.line(targetLine);
    const targetColumn = Math.max(selectionTarget.column, 1);
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
