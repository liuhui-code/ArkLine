import type { EditorCompletionTarget, EditorInsertTextTarget, EditorSelectionTarget } from "@/components/layout/EditorSurface";
import { useEffect, useMemo, useRef } from "react";
import { closeCompletion, startCompletion } from "@codemirror/autocomplete";
import { EditorSelection, EditorState, Transaction, type Text } from "@codemirror/state";
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
  editorDocumentReplacement,
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
import type { CodeMirrorCompletionBroker, CodeMirrorCompletionResolver } from "@/editor/codemirror-completion-source";
import type { CodeMirrorSignatureHelpBroker } from "@/editor/codemirror-signature-help";
import { recordRenderPressure } from "@/features/performance/use-ui-latency-monitor";
import { createEditorDocumentSessionRegistry } from "@/editor/editor-document-session-registry";
import { scheduleEditorEnhancement } from "@/editor/editor-enhancement-scheduler";
import { beginInteractionTrace, type InteractionTraceHandle } from "@/features/performance/interaction-trace-store";
import { createEditorInputTraceRuntime } from "@/features/performance/editor-input-trace-runtime";
import { getPathBasename } from "@/features/workspace/workspace-store";
type ArkTsEditorProps = {
  focusToken?: number;
  completionTarget?: EditorCompletionTarget | null;
  completionEnabled?: boolean;
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
  onCodeMirrorCompletionRequest?: CodeMirrorCompletionBroker;
  onCodeMirrorCompletionResolve?: CodeMirrorCompletionResolver;
  onCodeMirrorSignatureHelpRequest?: CodeMirrorSignatureHelpBroker;
  onContextMenu?: (request: EditorContextMenuRequest) => void;
  blameAttributions?: GitBlameAttribution[];
  gitBlameVisible?: boolean;
  selectedBlameLine?: number | null;
  onGitTraceLineClick?: (line: number) => void;
  transientPreview?: boolean;
};

const FULL_EDITOR_ENHANCEMENT_DWELL_MS = 1_500;

export function ArkTsEditor({
  focusToken = 0,
  completionTarget = null,
  completionEnabled = true,
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
  onCodeMirrorCompletionRequest,
  onCodeMirrorCompletionResolve,
  onCodeMirrorSignatureHelpRequest,
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
  const activeDocumentSourceRef = useRef<string | Text>(document ?? value);
  const activeTransientPreviewRef = useRef(transientPreview);
  const sessionsRef = useRef(createEditorDocumentSessionRegistry());
  const stateCreationCountRef = useRef(0);
  const inputStatsRef = useRef({ keyDown: 0, beforeInput: 0, documentChanged: 0, externalReplacement: 0 });
  const localDocumentsRef = useRef(new WeakSet<Text>());
  const activeEnhancedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onDocumentChangeRef = useRef(onDocumentChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onCaretRectChangeRef = useRef(onCaretRectChange);
  const onDefinitionTriggerRef = useRef(onDefinitionTrigger);
  const onDefinitionHoverChangeRef = useRef(onDefinitionHoverChange);
  const onTypingCompletionTriggerRef = useRef(onTypingCompletionTrigger);
  const onCodeMirrorCompletionRequestRef = useRef(onCodeMirrorCompletionRequest);
  const onCodeMirrorCompletionResolveRef = useRef(onCodeMirrorCompletionResolve);
  const completionEnabledRef = useRef(completionEnabled);
  const onCodeMirrorSignatureHelpRequestRef = useRef(onCodeMirrorSignatureHelpRequest);
  const onContextMenuRef = useRef(onContextMenu);
  const jumpRevealTimeoutRef = useRef<number | null>(null);
  const sessionRestoreFrameRef = useRef<number | null>(null);
  const editorSwitchTraceRef = useRef<InteractionTraceHandle | null>(null);
  const inputTraceRuntimeRef = useRef(createEditorInputTraceRuntime());
  const documentSource = document ?? value;
  const reducedPerformanceMode = useMemo(
    () => isEditorReducedPerformanceDocument(documentSource),
    [documentSource],
  );

  function publishSessionStats() {
    const host = hostRef.current;
    if (!host) return;
    host.dataset.hotSessionCount = String(sessionsRef.current.size());
    host.dataset.hotSessionCharacters = String(sessionsRef.current.retainedDocumentCharacters());
    host.dataset.stateCreationCount = String(stateCreationCountRef.current);
  }

  function publishInputStats() {
    const content = viewRef.current?.contentDOM;
    if (!content) return;
    const stats = inputStatsRef.current;
    content.dataset.keyDownCount = String(stats.keyDown);
    content.dataset.beforeInputCount = String(stats.beforeInput);
    content.dataset.documentChangeCount = String(stats.documentChanged);
    content.dataset.externalReplacementCount = String(stats.externalReplacement);
  }

  function publishCurrentSelectionStats() {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    view.contentDOM.dataset.selectionLength = String(selection.to - selection.from);
    view.contentDOM.dataset.selectionHead = String(selection.head);
  }

  onChangeRef.current = onChange;
  onDocumentChangeRef.current = onDocumentChange;
  onSelectionChangeRef.current = onSelectionChange;
  onCaretRectChangeRef.current = onCaretRectChange;
  onDefinitionTriggerRef.current = onDefinitionTrigger;
  onDefinitionHoverChangeRef.current = onDefinitionHoverChange;
  onTypingCompletionTriggerRef.current = onTypingCompletionTrigger;
  onCodeMirrorCompletionRequestRef.current = onCodeMirrorCompletionRequest;
  onCodeMirrorCompletionResolveRef.current = onCodeMirrorCompletionResolve;
  completionEnabledRef.current = completionEnabled;
  onCodeMirrorSignatureHelpRequestRef.current = onCodeMirrorSignatureHelpRequest;
  onContextMenuRef.current = onContextMenu;

  function createState(documentPath: string, content: string | Text, reducedMode: boolean) {
    stateCreationCountRef.current += 1;
    return EditorState.create({
      doc: content,
      extensions: createEditorExtensions(
        documentPath,
        appearance,
        (nextValue) => {
          inputTraceRuntimeRef.current.documentChanged();
          onChangeRef.current(nextValue);
        },
        onDocumentChange ? (document) => {
          inputTraceRuntimeRef.current.documentChanged();
          inputStatsRef.current.documentChanged += 1;
          localDocumentsRef.current.add(document);
          onDocumentChangeRef.current?.(document);
          publishInputStats();
        } : undefined,
        (selection, shouldMeasureCaret) => {
          onSelectionChangeRef.current?.(selection);
          const view = viewRef.current;
          if (view && shouldMeasureCaret) onCaretRectChangeRef.current?.(readCaretRect(view));
          publishInputStats();
        },
        (selection) => onDefinitionTriggerRef.current?.(selection),
        (state) => onDefinitionHoverChangeRef.current?.(state),
        (selection) => {
          const view = viewRef.current;
          if (view) onCaretRectChangeRef.current?.(readCaretRect(view));
          onTypingCompletionTriggerRef.current?.(selection);
        },
        (request) => onContextMenuRef.current?.(request),
        onCodeMirrorCompletionRequest
          ? (request) => onCodeMirrorCompletionRequestRef.current?.(request) ?? Promise.resolve([])
          : undefined,
        onCodeMirrorCompletionResolve
          ? (item, request) => onCodeMirrorCompletionResolveRef.current?.(item, request) ?? Promise.resolve(item)
          : undefined,
        () => activePathRef.current,
        gitBlameVisible
          ? { blameAttributions, selectedLine: selectedBlameLine, onSelectLine: onGitTraceLineClick }
          : undefined,
        reducedMode,
        true,
        onCodeMirrorSignatureHelpRequest
          ? (request, signal) => onCodeMirrorSignatureHelpRequestRef.current?.(request, signal) ?? Promise.resolve(null)
          : undefined,
        () => completionEnabledRef.current,
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
    activeDocumentSourceRef.current = documentSource;
    publishSessionStats();
    const contentDom = viewRef.current.contentDOM;
    contentDom.dataset.documentLength = String(viewRef.current.state.doc.length);
    publishCurrentSelectionStats();
    const handleBeforeInput = (event: InputEvent) => {
      inputStatsRef.current.beforeInput += 1;
      publishInputStats();
      inputTraceRuntimeRef.current.begin(
        getPathBasename(activePathRef.current),
        event.inputType || "unknown",
      );
    };
    const handleKeyDown = () => {
      inputStatsRef.current.keyDown += 1;
      publishInputStats();
    };
    contentDom.addEventListener("beforeinput", handleBeforeInput);
    contentDom.addEventListener("keydown", handleKeyDown);
    publishInputStats();
    onCaretRectChangeRef.current?.(readCaretRect(viewRef.current));

    return () => {
      if (jumpRevealTimeoutRef.current != null) {
        window.clearTimeout(jumpRevealTimeoutRef.current);
      }
      if (sessionRestoreFrameRef.current != null) {
        window.cancelAnimationFrame(sessionRestoreFrameRef.current);
      }
      editorSwitchTraceRef.current?.finish("cancelled");
      inputTraceRuntimeRef.current.cancel();
      contentDom.removeEventListener("beforeinput", handleBeforeInput);
      contentDom.removeEventListener("keydown", handleKeyDown);
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    if (activePathRef.current === path) {
      activeTransientPreviewRef.current = transientPreview;
      return;
    }

    editorSwitchTraceRef.current?.finish("superseded");
    const switchTrace = beginInteractionTrace("editorSwitch", getPathBasename(path));
    editorSwitchTraceRef.current = switchTrace;
    const statePhase = switchTrace.startPhase("applyEditorState");
    if (activeTransientPreviewRef.current) {
      sessionsRef.current.delete(activePathRef.current);
    } else {
      const selection = view.state.selection.main;
      sessionsRef.current.save(activePathRef.current, {
        selectionAnchor: selection.anchor,
        selectionHead: selection.head,
        scrollTop: view.scrollDOM.scrollTop,
        scrollLeft: view.scrollDOM.scrollLeft,
        enhanced: activeEnhancedRef.current,
      });
    }
    const cached = sessionsRef.current.restore(path);
    const cachedMatchesDocument = cached != null;

    activePathRef.current = path;
    activeDocumentSourceRef.current = documentSource;
    activeTransientPreviewRef.current = transientPreview;
    activeEnhancedRef.current = cachedMatchesDocument ? cached.enhanced : false;
    const targetLength = documentSource.length;
    const selectionAnchor = Math.min(cached?.selectionAnchor ?? 0, targetLength);
    const selectionHead = Math.min(cached?.selectionHead ?? 0, targetLength);
    const deferEnhancements = reducedPerformanceMode || !activeEnhancedRef.current;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: documentSource },
      selection: EditorSelection.range(selectionAnchor, selectionHead),
      annotations: [
        editorDocumentReplacement.of(true),
        Transaction.addToHistory.of(false),
      ],
      effects: [
        editorStructureCompartment.reconfigure(structureExtensionForDocument(deferEnhancements)),
        languageCompartment.reconfigure(languageExtensionForPath(path, deferEnhancements)),
      ],
    });
    publishSessionStats();
    publishInputStats();
    publishCurrentSelectionStats();
    statePhase.finish();
    if (sessionRestoreFrameRef.current != null) {
      window.cancelAnimationFrame(sessionRestoreFrameRef.current);
    }
    const framePhase = switchTrace.startPhase("nextFrame");
    sessionRestoreFrameRef.current = window.requestAnimationFrame(() => {
      if (viewRef.current !== view || activePathRef.current !== path) {
        framePhase.finish("superseded");
        switchTrace.finish("superseded");
        return;
      }
      view.scrollDOM.scrollTop = cachedMatchesDocument ? cached.scrollTop : 0;
      view.scrollDOM.scrollLeft = cachedMatchesDocument ? cached.scrollLeft : 0;
      framePhase.finish();
      switchTrace.finish();
      if (editorSwitchTraceRef.current === switchTrace) editorSwitchTraceRef.current = null;
      sessionRestoreFrameRef.current = null;
    });
  }, [appearance, documentSource, onDocumentChange, path, reducedPerformanceMode, transientPreview]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || activePathRef.current !== path) {
      return;
    }

    const isStaleLocalSnapshot = typeof documentSource !== "string"
      && localDocumentsRef.current.has(documentSource);
    const sourceWasAlreadyApplied = activeDocumentSourceRef.current === documentSource;
    if (!isStaleLocalSnapshot && !sourceWasAlreadyApplied && !documentMatches(view.state.doc, documentSource)) {
      inputStatsRef.current.externalReplacement += 1;
      const selection = view.state.selection.main;
      const anchor = Math.min(selection.anchor, documentSource.length);
      const head = Math.min(selection.head, documentSource.length);

      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: documentSource },
        selection: EditorSelection.range(anchor, head),
        annotations: [
          editorDocumentReplacement.of(true),
          Transaction.addToHistory.of(false),
        ],
      });
      activeDocumentSourceRef.current = documentSource;
      publishInputStats();
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
    }, undefined, transientPreview ? 2_500 : FULL_EDITOR_ENHANCEMENT_DWELL_MS);
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

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!completionEnabled || completionTarget?.action === "close") {
      closeCompletion(view);
      return;
    }
    if (completionTarget?.action === "open") {
      view.focus();
      startCompletion(view);
    }
  }, [completionEnabled, completionTarget]);

  return <div className="editor-codemirror" ref={hostRef} />;
}

function documentMatches(current: Text, source: string | Text) {
  return typeof source === "string"
    ? current.length === source.length && current.toString() === source
    : current === source;
}
