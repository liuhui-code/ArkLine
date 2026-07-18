import { memo, type MutableRefObject, type RefObject } from "react";
import { EditorQueryPanel } from "@/components/layout/EditorQueryPanel";
import { EditorSurface } from "@/components/layout/EditorSurface";
import { useLatestCallback } from "@/components/layout/use-latest-callback";
import type { EditorCaretRect, EditorLineColumn } from "@/editor/editor-events";
import type { DocumentRuntimeStore } from "@/features/documents/document-runtime-store";
import type { GitBlameAttribution } from "@/features/git/git-trace-model";
import type { UsageResult, UsageSearchState } from "@/features/workspace/usage-search";
import type { EditorAppearance } from "@/types/editor";
import { recordRenderPressure } from "@/features/performance/use-ui-latency-monitor";
import type { Text } from "@codemirror/state";

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
  insertTextTarget: { text: string; replaceBefore?: number; nonce: number } | null;
  selectionTarget: { line: number; column: number; nonce: number } | null;
  workspaceName: string | null;
  surfaceRef: RefObject<HTMLElement | null>;
  onChange: (content: string) => void;
  onDocumentChange?: (document: Text) => void;
  onSelectionChange: (selection: { line: number; column: number; selectedText?: string }) => void;
  onCaretRectChange: (rect: EditorCaretRect) => void;
  onDefinitionTrigger: (selection?: EditorLineColumn) => void;
  onTypingCompletionTrigger: (selection: EditorLineColumn) => void;
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
};

const MemoEditorSurface = memo(EditorSurface);

export function AppShellEditorWorkbench(props: AppShellEditorWorkbenchProps) {
  recordRenderPressure("AppShell/EditorWorkbench");
  const onChange = useLatestCallback(props.onChange);
  const onDocumentChange = useLatestCallback((document: Text) => props.onDocumentChange?.(document));
  const onSelectionChange = useLatestCallback(props.onSelectionChange);
  const onCaretRectChange = useLatestCallback(props.onCaretRectChange);
  const onDefinitionTrigger = useLatestCallback(props.onDefinitionTrigger);
  const onTypingCompletionTrigger = useLatestCallback(props.onTypingCompletionTrigger);
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
      <MemoEditorSurface
        activePath={props.activePath}
        documentsRef={props.documentsRef}
        openTabs={props.openTabs}
        appearance={props.appearance}
        focusToken={props.focusToken}
        insertTextTarget={props.insertTextTarget}
        selectionTarget={props.selectionTarget}
        workspaceName={props.workspaceName}
        surfaceRef={props.surfaceRef}
        onChange={onChange}
        onDocumentChange={props.onDocumentChange ? onDocumentChange : undefined}
        onSelectionChange={onSelectionChange}
        onCaretRectChange={onCaretRectChange}
        onDefinitionTrigger={onDefinitionTrigger}
        onTypingCompletionTrigger={onTypingCompletionTrigger}
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
      />
    </div>
  );
}
