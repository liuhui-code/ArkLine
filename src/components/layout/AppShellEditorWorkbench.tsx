import { memo, type MutableRefObject, type RefObject } from "react";
import { EditorQueryPanel } from "@/components/layout/EditorQueryPanel";
import { EditorSurface } from "@/components/layout/EditorSurface";
import { GitEditorDiffPreview } from "@/components/layout/GitEditorDiffPreview";
import { useLatestCallback } from "@/components/layout/use-latest-callback";
import type { EditorCaretRect, EditorLineColumn } from "@/editor/editor-events";
import type { DocumentRuntimeStore } from "@/features/documents/document-runtime-store";
import type { GitBlameAttribution } from "@/features/git/git-trace-model";
import type { DiffFile } from "@/features/diff/unified-diff";
import type { GitDiffActionContext, GitFileComparison, GitPatchAction } from "@/features/git/git-source-control-model";
import type { UsageResult, UsageSearchState } from "@/features/workspace/usage-search";
import type { EditorAppearance } from "@/types/editor";
import { recordRenderPressure } from "@/features/performance/use-ui-latency-monitor";
import type { Text } from "@codemirror/state";
import type { CodeMirrorCompletionBroker, CodeMirrorCompletionResolver } from "@/editor/codemirror-completion-source";
import type { CodeMirrorSignatureHelpBroker } from "@/editor/codemirror-signature-help";
import type {
  EditorDiagnosticFixRequestHandler,
  EditorValidationRequest,
  EditorValidationResultHandler,
} from "@/editor/editor-validation-lint";

export type AppShellEditorWorkbenchProps = {
  queryPanelVisible: boolean;
  usageSearch: UsageSearchState;
  onCloseEditorQueryPanel: () => void;
  onOpenUsage: (item: UsageResult) => void;
  activePath: string | null;
  documentsRef: MutableRefObject<DocumentRuntimeStore>;
  openTabs: { path: string; title: string; isDirty: boolean }[];
  appearance: EditorAppearance;
  focusToken: number;
  completionTarget: { action: "open" | "close"; nonce: number } | null;
  completionEnabled: boolean;
  insertTextTarget: { text: string; replaceBefore?: number; nonce: number } | null;
  selectionTarget: { line: number; column: number; nonce: number } | null;
  workspaceName: string | null;
  surfaceRef: RefObject<HTMLElement | null>;
  onChange: (content: string) => void;
  onDocumentChange?: (document: Text) => void;
  onSelectionChange: (selection: { line: number; column: number; selectedText?: string }) => void;
  onCaretRectChange?: (rect: EditorCaretRect) => void;
  onDefinitionTrigger: (selection?: EditorLineColumn) => void;
  onTypingCompletionTrigger?: (selection: EditorLineColumn) => void;
  onCodeMirrorCompletionRequest?: CodeMirrorCompletionBroker;
  onCodeMirrorCompletionResolve?: CodeMirrorCompletionResolver;
  onCodeMirrorSignatureHelpRequest?: CodeMirrorSignatureHelpBroker;
  onValidationRequest?: EditorValidationRequest;
  onValidationResult?: EditorValidationResultHandler;
  onDiagnosticFixRequest?: EditorDiagnosticFixRequestHandler;
  blameAttributions: GitBlameAttribution[];
  gitBlameVisible: boolean;
  selectedBlameLine: number | null;
  onGitTraceLineClick: (line: number) => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onCloseOtherTabs: (path: string) => void;
  onCloseTabsToRight: (path: string) => void;
  onCopyTabPath: (path: string) => void;
  onEditorGoToDefinition: (selection?: EditorLineColumn) => void;
  onEditorFindUsages: () => void;
  onEditorFormatDocument: () => void;
  onEditorCopyPath: () => void;
  onToggleGitBlame: () => void;
  gitDiffPreview?: {
    files: DiffFile[];
    comparison: GitFileComparison | null;
    actionContext: GitDiffActionContext | null;
    onApplyPartial: (action: GitPatchAction, patch: string, context: GitDiffActionContext) => Promise<void>;
    onOpenFile: (path: string) => void;
    onClose: () => void;
  } | null;
};

const MemoEditorSurface = memo(EditorSurface);

export function AppShellEditorWorkbench(props: AppShellEditorWorkbenchProps) {
  recordRenderPressure("AppShell/EditorWorkbench");
  const onChange = useLatestCallback(props.onChange);
  const onDocumentChange = useLatestCallback((document: Text) => props.onDocumentChange?.(document));
  const onSelectionChange = useLatestCallback(props.onSelectionChange);
  const onCaretRectChange = useLatestCallback((rect: EditorCaretRect) => props.onCaretRectChange?.(rect));
  const onDefinitionTrigger = useLatestCallback(props.onDefinitionTrigger);
  const onTypingCompletionTrigger = useLatestCallback((selection: EditorLineColumn) => props.onTypingCompletionTrigger?.(selection));
  const onCodeMirrorCompletionRequest = useLatestCallback((request: Parameters<CodeMirrorCompletionBroker>[0]) => (
    props.onCodeMirrorCompletionRequest?.(request) ?? Promise.resolve([])
  ));
  const onCodeMirrorCompletionResolve = useLatestCallback((item: Parameters<CodeMirrorCompletionResolver>[0], request: Parameters<CodeMirrorCompletionResolver>[1]) => (
    props.onCodeMirrorCompletionResolve?.(item, request) ?? Promise.resolve(item)
  ));
  const onCodeMirrorSignatureHelpRequest = useLatestCallback((request: Parameters<CodeMirrorSignatureHelpBroker>[0], signal: AbortSignal) => (
    props.onCodeMirrorSignatureHelpRequest?.(request, signal) ?? Promise.resolve(null)
  ));
  const onValidationResult: EditorValidationResultHandler = useLatestCallback((
    path: string,
    problems: Parameters<EditorValidationResultHandler>[1],
  ) => {
    props.onValidationResult?.(path, problems);
  });
  const onDiagnosticFixRequest = useLatestCallback((request: Parameters<EditorDiagnosticFixRequestHandler>[0]) => {
    props.onDiagnosticFixRequest?.(request);
  });
  const onGitTraceLineClick = useLatestCallback(props.onGitTraceLineClick);
  const onSelectTab = useLatestCallback(props.onSelectTab);
  const onCloseTab = useLatestCallback(props.onCloseTab);
  const onCloseOtherTabs = useLatestCallback(props.onCloseOtherTabs);
  const onCloseTabsToRight = useLatestCallback(props.onCloseTabsToRight);
  const onCopyTabPath = useLatestCallback(props.onCopyTabPath);
  const onEditorGoToDefinition = useLatestCallback(props.onEditorGoToDefinition);
  const onEditorFindUsages = useLatestCallback(props.onEditorFindUsages);
  const onEditorFormatDocument = useLatestCallback(props.onEditorFormatDocument);
  const onEditorCopyPath = useLatestCallback(props.onEditorCopyPath);
  const onToggleGitBlame = useLatestCallback(props.onToggleGitBlame);

  return (
    <div className="editor-workbench">
      {props.queryPanelVisible ? (
        <EditorQueryPanel
          state={props.usageSearch}
          onClose={props.onCloseEditorQueryPanel}
          onOpenUsage={props.onOpenUsage}
        />
      ) : null}
      {props.gitDiffPreview ? <GitEditorDiffPreview {...props.gitDiffPreview} /> : <MemoEditorSurface
        activePath={props.activePath}
        documentsRef={props.documentsRef}
        openTabs={props.openTabs}
        appearance={props.appearance}
        focusToken={props.focusToken}
        completionTarget={props.completionTarget}
        completionEnabled={props.completionEnabled}
        insertTextTarget={props.insertTextTarget}
        selectionTarget={props.selectionTarget}
        workspaceName={props.workspaceName}
        surfaceRef={props.surfaceRef}
        onChange={onChange}
        onDocumentChange={props.onDocumentChange ? onDocumentChange : undefined}
        onSelectionChange={onSelectionChange}
        onCaretRectChange={props.onCaretRectChange ? onCaretRectChange : undefined}
        onDefinitionTrigger={onDefinitionTrigger}
        onTypingCompletionTrigger={props.onTypingCompletionTrigger ? onTypingCompletionTrigger : undefined}
        onCodeMirrorCompletionRequest={props.onCodeMirrorCompletionRequest ? onCodeMirrorCompletionRequest : undefined}
        onCodeMirrorCompletionResolve={props.onCodeMirrorCompletionResolve ? onCodeMirrorCompletionResolve : undefined}
        onCodeMirrorSignatureHelpRequest={props.onCodeMirrorSignatureHelpRequest ? onCodeMirrorSignatureHelpRequest : undefined}
        onValidationRequest={props.onValidationRequest}
        onValidationResult={props.onValidationResult ? onValidationResult : undefined}
        onDiagnosticFixRequest={props.onDiagnosticFixRequest ? onDiagnosticFixRequest : undefined}
        blameAttributions={props.blameAttributions}
        gitBlameVisible={props.gitBlameVisible}
        selectedBlameLine={props.selectedBlameLine}
        onGitTraceLineClick={onGitTraceLineClick}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onCloseOtherTabs={onCloseOtherTabs}
        onCloseTabsToRight={onCloseTabsToRight}
        onCopyTabPath={onCopyTabPath}
        onEditorGoToDefinition={onEditorGoToDefinition}
        onEditorFindUsages={onEditorFindUsages}
        onEditorFormatDocument={onEditorFormatDocument}
        onEditorCopyPath={onEditorCopyPath}
        onToggleGitBlame={onToggleGitBlame}
      />}
    </div>
  );
}
