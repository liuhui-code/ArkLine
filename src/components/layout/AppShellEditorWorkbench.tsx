import type { MutableRefObject, RefObject } from "react";
import { EditorQueryPanel } from "@/components/layout/EditorQueryPanel";
import { EditorSurface } from "@/components/layout/EditorSurface";
import type { DefinitionHoverState, EditorCaretRect, EditorLineColumn } from "@/editor/editor-events";
import type { DocumentRuntimeStore } from "@/features/documents/document-runtime-store";
import type { GitBlameAttribution } from "@/features/git/git-trace-model";
import type { UsageResult, UsageSearchState } from "@/features/workspace/usage-search";
import type { EditorAppearance } from "@/types/editor";

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
  onSelectionChange: (selection: { line: number; column: number; selectedText?: string }) => void;
  onCaretRectChange: (rect: EditorCaretRect) => void;
  onDefinitionTrigger: (selection?: EditorLineColumn) => void;
  onDefinitionHoverChange: (state: DefinitionHoverState) => void;
  onTypingCompletionTrigger: (selection: EditorLineColumn) => void;
  blameAttributions: GitBlameAttribution[];
  gitBlameVisible: boolean;
  selectedBlameLine: number | null;
  onGitTraceLineClick: (line: number) => void;
  definitionHoverActive: boolean;
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

export function AppShellEditorWorkbench(props: AppShellEditorWorkbenchProps) {
  return (
    <div className="editor-workbench">
      {props.queryPanelVisible ? (
        <EditorQueryPanel
          state={props.usageSearch}
          onClose={props.onCloseEditorQueryPanel}
          onOpenUsage={props.onOpenUsage}
        />
      ) : null}
      <EditorSurface
        activePath={props.activePath}
        documentsRef={props.documentsRef}
        openTabs={props.openTabs}
        appearance={props.appearance}
        focusToken={props.focusToken}
        insertTextTarget={props.insertTextTarget}
        selectionTarget={props.selectionTarget}
        workspaceName={props.workspaceName}
        surfaceRef={props.surfaceRef}
        onChange={props.onChange}
        onSelectionChange={props.onSelectionChange}
        onCaretRectChange={props.onCaretRectChange}
        onDefinitionTrigger={props.onDefinitionTrigger}
        onDefinitionHoverChange={props.onDefinitionHoverChange}
        onTypingCompletionTrigger={props.onTypingCompletionTrigger}
        blameAttributions={props.blameAttributions}
        gitBlameVisible={props.gitBlameVisible}
        selectedBlameLine={props.selectedBlameLine}
        onGitTraceLineClick={props.onGitTraceLineClick}
        definitionHoverActive={props.definitionHoverActive}
        onSelectTab={props.onSelectTab}
        onCloseTab={props.onCloseTab}
        onCloseOtherTabs={props.onCloseOtherTabs}
        onCloseTabsToRight={props.onCloseTabsToRight}
        onCopyTabPath={props.onCopyTabPath}
        onEditorGoToDefinition={props.onEditorGoToDefinition}
        onEditorFindUsages={props.onEditorFindUsages}
        onEditorFormatDocument={props.onEditorFormatDocument}
        onEditorCopyPath={props.onEditorCopyPath}
        onToggleGitBlame={props.onToggleGitBlame}
      />
    </div>
  );
}
