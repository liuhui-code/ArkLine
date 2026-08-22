import { Suspense, lazy, memo, useCallback, useRef } from "react";
import type { EditorCompletionTarget, EditorInsertTextTarget, EditorSelectionTarget } from "@/components/layout/EditorSurface";
import type { DefinitionHoverState, EditorCaretRect, EditorContextMenuRequest, EditorLineColumn } from "@/editor/editor-events";
import type { GitBlameAttribution } from "@/features/git/git-trace-model";
import type { EditorAppearance } from "@/types/editor";
import type { CodeMirrorCompletionBroker, CodeMirrorCompletionResolver } from "@/editor/codemirror-completion-source";
import type { CodeMirrorSignatureHelpBroker } from "@/editor/codemirror-signature-help";
import type {
  EditorDiagnosticFixRequestHandler,
  EditorValidationRequest,
  EditorValidationResultHandler,
} from "@/editor/editor-validation-lint";
import type { Text } from "@codemirror/state";

const ArkTsEditor = lazy(async () => {
  const module = await import("@/editor/ArkTsEditor");
  return { default: module.ArkTsEditor };
});
const MemoArkTsEditor = memo(ArkTsEditor);

type LazyArkTsEditorProps = {
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
  onValidationRequest?: EditorValidationRequest;
  onValidationResult?: EditorValidationResultHandler;
  onDiagnosticFixRequest?: EditorDiagnosticFixRequestHandler;
  onContextMenu?: (request: EditorContextMenuRequest) => void;
  blameAttributions?: GitBlameAttribution[];
  gitBlameVisible?: boolean;
  selectedBlameLine?: number | null;
  onGitTraceLineClick?: (line: number) => void;
  transientPreview?: boolean;
};

export function LazyArkTsEditor(props: LazyArkTsEditorProps) {
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  const onChange = useCallback((value: string) => callbacksRef.current.onChange(value), []);
  const onDocumentChange = useCallback((document: Text) => callbacksRef.current.onDocumentChange?.(document), []);
  const onSelectionChange = useCallback((selection: { line: number; column: number; selectedText?: string }) => {
    callbacksRef.current.onSelectionChange?.(selection);
  }, []);
  const onCaretRectChange = useCallback((rect: EditorCaretRect) => callbacksRef.current.onCaretRectChange?.(rect), []);
  const onDefinitionTrigger = useCallback((selection?: EditorLineColumn) => {
    callbacksRef.current.onDefinitionTrigger?.(selection);
  }, []);
  const onDefinitionHoverChange = useCallback((state: DefinitionHoverState) => {
    callbacksRef.current.onDefinitionHoverChange?.(state);
  }, []);
  const onTypingCompletionTrigger = useCallback((selection: EditorLineColumn) => {
    callbacksRef.current.onTypingCompletionTrigger?.(selection);
  }, []);
  const onCodeMirrorCompletionRequest = useCallback<CodeMirrorCompletionBroker>(
    (request) => callbacksRef.current.onCodeMirrorCompletionRequest?.(request) ?? Promise.resolve([]),
    [],
  );
  const onCodeMirrorCompletionResolve = useCallback<CodeMirrorCompletionResolver>(
    (item, request) => callbacksRef.current.onCodeMirrorCompletionResolve?.(item, request) ?? Promise.resolve(item),
    [],
  );
  const onCodeMirrorSignatureHelpRequest = useCallback<CodeMirrorSignatureHelpBroker>(
    (request, signal) => callbacksRef.current.onCodeMirrorSignatureHelpRequest?.(request, signal) ?? Promise.resolve(null),
    [],
  );
  const onValidationRequest = useCallback<EditorValidationRequest>(
    (path, content) => callbacksRef.current.onValidationRequest?.(path, content) ?? Promise.resolve([]),
    [],
  );
  const onValidationResult = useCallback<EditorValidationResultHandler>(
    (path, problems) => callbacksRef.current.onValidationResult?.(path, problems),
    [],
  );
  const onDiagnosticFixRequest = useCallback<EditorDiagnosticFixRequestHandler>(
    (request) => callbacksRef.current.onDiagnosticFixRequest?.(request),
    [],
  );
  const onContextMenu = useCallback((request: EditorContextMenuRequest) => {
    callbacksRef.current.onContextMenu?.(request);
  }, []);
  const onGitTraceLineClick = useCallback((line: number) => callbacksRef.current.onGitTraceLineClick?.(line), []);

  return (
    <Suspense fallback={<div className="editor-loading">Loading editor...</div>}>
      <MemoArkTsEditor
        {...props}
        onChange={onChange}
        onDocumentChange={props.onDocumentChange ? onDocumentChange : undefined}
        onSelectionChange={props.onSelectionChange ? onSelectionChange : undefined}
        onCaretRectChange={props.onCaretRectChange ? onCaretRectChange : undefined}
        onDefinitionTrigger={props.onDefinitionTrigger ? onDefinitionTrigger : undefined}
        onDefinitionHoverChange={props.onDefinitionHoverChange ? onDefinitionHoverChange : undefined}
        onTypingCompletionTrigger={props.onTypingCompletionTrigger ? onTypingCompletionTrigger : undefined}
        onCodeMirrorCompletionRequest={props.onCodeMirrorCompletionRequest ? onCodeMirrorCompletionRequest : undefined}
        onCodeMirrorCompletionResolve={props.onCodeMirrorCompletionResolve ? onCodeMirrorCompletionResolve : undefined}
        onCodeMirrorSignatureHelpRequest={props.onCodeMirrorSignatureHelpRequest ? onCodeMirrorSignatureHelpRequest : undefined}
        onValidationRequest={props.onValidationRequest ? onValidationRequest : undefined}
        onValidationResult={props.onValidationResult ? onValidationResult : undefined}
        onDiagnosticFixRequest={props.onDiagnosticFixRequest ? onDiagnosticFixRequest : undefined}
        onContextMenu={props.onContextMenu ? onContextMenu : undefined}
        onGitTraceLineClick={props.onGitTraceLineClick ? onGitTraceLineClick : undefined}
      />
    </Suspense>
  );
}
