import type { EditorInsertTextTarget, EditorSelectionTarget } from "@/components/layout/EditorSurface";
import { useEffect, useMemo, useRef } from "react";
import { EditorSelection, EditorState, type Text } from "@codemirror/state";
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
import { isEditorReducedPerformanceDocument } from "@/editor/editor-document-budget";
import { createGitTraceGutter } from "@/editor/git-trace-decorations";
import type { GitBlameAttribution } from "@/features/git/git-trace-model";
import type { EditorAppearance } from "@/types/editor";
import { recordRenderPressure } from "@/features/performance/use-ui-latency-monitor";
import { createEditorDocumentSessionRegistry } from "@/editor/editor-document-session-registry";
import { scheduleEditorEnhancement } from "@/editor/editor-enhancement-scheduler";

type ArkTsEditorProps = {
  focusToken?: number;
  path: string;
  value?: string;
  document?: Text;
  appearance: EditorAppearance;
  selectionTarget?: EditorSelectionTarget | null;
  insertTextTarget?: EditorInsertTextTarget | null;
  onChange: (value: string) => void;
  onDocumentChange?: (document: Text) => void;
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
  transientPreview?: boolean;
};

export function ArkTsEditor({
  focusToken = 0,
  path,
  value = "",
  document,
  appearance,
  selectionTarget = null,
  insertTextTarget = null,
  onChange,
  onDocumentChange,
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
  transientPreview = false,
}: ArkTsEditorProps) {
  recordRenderPressure("Editor/ArkTsEditor");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activePathRef = useRef(path);
  const sessionsRef = useRef(createEditorDocumentSessionRegistry());
  const activeEnhancedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onDocumentChangeRef = useRef(onDocumentChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onCaretRectChangeRef = useRef(onCaretRectChange);
  const onDefinitionTriggerRef = useRef(onDefinitionTrigger);
  const onDefinitionHoverChangeRef = useRef(onDefinitionHoverChange);
  const onTypingCompletionTriggerRef = useRef(onTypingCompletionTrigger);
  const onContextMenuRef = useRef(onContextMenu);
  const jumpRevealTimeoutRef = useRef<number | null>(null);
  const sessionRestoreFrameRef = useRef<number | null>(null);
  const documentSource = document ?? value;
  const reducedPerformanceMode = useMemo(
    () => isEditorReducedPerformanceDocument(documentSource),
    [documentSource],
  );

  onChangeRef.current = onChange;
  onDocumentChangeRef.current = onDocumentChange;
  onSelectionChangeRef.current = onSelectionChange;
  onCaretRectChangeRef.current = onCaretRectChange;
  onDefinitionTriggerRef.current = onDefinitionTrigger;
  onDefinitionHoverChangeRef.current = onDefinitionHoverChange;
  onTypingCompletionTriggerRef.current = onTypingCompletionTrigger;
  onContextMenuRef.current = onContextMenu;

  function createState(documentPath: string, content: string | Text, reducedMode: boolean) {
    return EditorState.create({
      doc: content,
      extensions: createEditorExtensions(
        documentPath,
        appearance,
        (nextValue) => onChangeRef.current(nextValue),
        onDocumentChange ? (document) => onDocumentChangeRef.current?.(document) : undefined,
        (selection, shouldMeasureCaret) => {
          onSelectionChangeRef.current?.(selection);
          const view = viewRef.current;
          if (view && shouldMeasureCaret) onCaretRectChangeRef.current?.(readCaretRect(view));
        },
        (selection) => onDefinitionTriggerRef.current?.(selection),
        (state) => onDefinitionHoverChangeRef.current?.(state),
        (selection) => {
          const view = viewRef.current;
          if (view) onCaretRectChangeRef.current?.(readCaretRect(view));
          onTypingCompletionTriggerRef.current?.(selection);
        },
        (request) => onContextMenuRef.current?.(request),
        gitBlameVisible
          ? { blameAttributions, selectedLine: selectedBlameLine, onSelectLine: onGitTraceLineClick }
          : undefined,
        reducedMode,
        true,
      ),
    });
  }

  useEffect(() => {
    if (!hostRef.current || viewRef.current) {
      return;
    }

    const state = createState(path, documentSource, reducedPerformanceMode);

    viewRef.current = new EditorView({
      state,
      parent: hostRef.current,
    });
    onCaretRectChangeRef.current?.(readCaretRect(viewRef.current));

    return () => {
      if (jumpRevealTimeoutRef.current != null) {
        window.clearTimeout(jumpRevealTimeoutRef.current);
      }
      if (sessionRestoreFrameRef.current != null) {
        window.cancelAnimationFrame(sessionRestoreFrameRef.current);
      }
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || activePathRef.current === path) {
      return;
    }

    sessionsRef.current.save(activePathRef.current, {
      state: view.state,
      scrollTop: view.scrollDOM.scrollTop,
      scrollLeft: view.scrollDOM.scrollLeft,
      enhanced: activeEnhancedRef.current,
    });
    const cached = sessionsRef.current.restore(path);
    const cachedMatchesDocument = cached && documentMatches(cached.state.doc, documentSource);
    const nextState = cachedMatchesDocument
      ? cached.state
      : createState(path, documentSource, reducedPerformanceMode);

    activePathRef.current = path;
    activeEnhancedRef.current = cachedMatchesDocument ? cached.enhanced : false;
    view.setState(nextState);
    if (sessionRestoreFrameRef.current != null) {
      window.cancelAnimationFrame(sessionRestoreFrameRef.current);
    }
    sessionRestoreFrameRef.current = window.requestAnimationFrame(() => {
      if (viewRef.current !== view || activePathRef.current !== path) return;
      view.scrollDOM.scrollTop = cachedMatchesDocument ? cached.scrollTop : 0;
      view.scrollDOM.scrollLeft = cachedMatchesDocument ? cached.scrollLeft : 0;
      sessionRestoreFrameRef.current = null;
    });
  }, [appearance, documentSource, onDocumentChange, path, reducedPerformanceMode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || activePathRef.current !== path) {
      return;
    }

    if (!documentMatches(view.state.doc, documentSource)) {
      const selection = view.state.selection.main;
      const anchor = Math.min(selection.anchor, documentSource.length);
      const head = Math.min(selection.head, documentSource.length);

      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: documentSource },
        selection: EditorSelection.range(anchor, head),
      });
    }
  }, [documentSource, path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || reducedPerformanceMode || activeEnhancedRef.current) {
      return;
    }

    const scheduledPath = path;
    return scheduleEditorEnhancement(() => {
      if (viewRef.current !== view || activePathRef.current !== scheduledPath) return;
      view.dispatch({
        effects: [
          editorStructureCompartment.reconfigure(structureExtensionForDocument(false)),
          languageCompartment.reconfigure(languageExtensionForPath(scheduledPath, false)),
        ],
      });
      activeEnhancedRef.current = true;
    }, undefined, transientPreview ? 2_500 : 0);
  }, [path, reducedPerformanceMode, transientPreview]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: appearanceCompartment.reconfigure(appearanceExtensionForSettings(appearance)),
    });
  }, [appearance]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: gitTraceCompartment.reconfigure(
        gitBlameVisible && !reducedPerformanceMode
          ? createGitTraceGutter({
              blameAttributions,
              selectedLine: selectedBlameLine,
              onSelectLine: onGitTraceLineClick,
            })
          : [],
      ),
    });
  }, [blameAttributions, gitBlameVisible, onGitTraceLineClick, reducedPerformanceMode, selectedBlameLine]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !selectionTarget) {
      return;
    }
    if (sessionRestoreFrameRef.current != null) {
      window.cancelAnimationFrame(sessionRestoreFrameRef.current);
      sessionRestoreFrameRef.current = null;
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

function documentMatches(current: Text, source: string | Text) {
  return typeof source === "string"
    ? current.length === source.length && current.toString() === source
    : current === source;
}
