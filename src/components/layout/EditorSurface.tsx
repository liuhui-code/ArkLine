import type { DefinitionHoverState, EditorCaretRect, EditorContextMenuRequest, EditorLineColumn } from "@/editor/editor-events";
import type { GitBlameAttribution } from "@/features/git/git-trace-model";
import { useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { ContextMenu, type ContextMenuState } from "@/components/layout/ContextMenu";
import { LazyArkTsEditor } from "@/editor/LazyArkTsEditor";
import { MainWorkspaceView } from "@/features/workspace/MainWorkspaceView";
import type { EditorAppearance } from "@/types/editor";

export type EditorSelectionTarget = {
  line: number;
  column: number;
  nonce: number;
};

export type EditorInsertTextTarget = {
  text: string;
  replaceBefore?: number;
  nonce: number;
};

type EditorTab = {
  path: string;
  title: string;
  isDirty: boolean;
};

type EditorSurfaceProps = {
  activePath: string | null;
  content: string;
  openTabs: EditorTab[];
  appearance: EditorAppearance;
  focusToken: number;
  selectionTarget: EditorSelectionTarget | null;
  insertTextTarget: EditorInsertTextTarget | null;
  workspaceName: string | null;
  surfaceRef: RefObject<HTMLElement | null>;
  onChange: (value: string) => void;
  onSelectionChange: (selection: { line: number; column: number; selectedText?: string }) => void;
  onCaretRectChange?: (rect: EditorCaretRect) => void;
  onDefinitionTrigger?: (selection?: EditorLineColumn) => void;
  onDefinitionHoverChange?: (state: DefinitionHoverState) => void;
  onTypingCompletionTrigger?: (selection: EditorLineColumn) => void;
  blameAttributions?: GitBlameAttribution[];
  gitBlameVisible?: boolean;
  selectedBlameLine?: number | null;
  onGitTraceLineClick?: (line: number) => void;
  definitionHoverActive?: boolean;
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

export function EditorSurface({
  activePath,
  content,
  openTabs,
  appearance,
  focusToken,
  selectionTarget,
  insertTextTarget,
  workspaceName,
  surfaceRef,
  onChange,
  onSelectionChange,
  onCaretRectChange,
  onDefinitionTrigger,
  onDefinitionHoverChange,
  onTypingCompletionTrigger,
  blameAttributions = [],
  gitBlameVisible = false,
  selectedBlameLine = null,
  onGitTraceLineClick,
  definitionHoverActive = false,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCopyTabPath,
  onEditorGoToDefinition,
  onEditorFindUsages,
  onEditorFormatDocument,
  onEditorCopyPath,
  onToggleGitBlame,
}: EditorSurfaceProps) {
  const surfaceStateClass = activePath ? "editor-surface--active" : "editor-surface--empty";
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  function openTabContextMenu(event: ReactMouseEvent<HTMLButtonElement>, tab: EditorTab, index: number) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      label: `${tab.title} tab actions`,
      x: event.clientX,
      y: event.clientY,
      items: [
        { id: "close", label: "Close", shortcut: "Ctrl+W", onSelect: () => onCloseTab(tab.path) },
        {
          id: "close-others",
          label: "Close Others",
          disabled: openTabs.length <= 1,
          onSelect: () => onCloseOtherTabs(tab.path),
        },
        {
          id: "close-right",
          label: "Close Tabs to the Right",
          disabled: index >= openTabs.length - 1,
          onSelect: () => onCloseTabsToRight(tab.path),
        },
        { id: "copy-path", label: "Copy Path", separatorBefore: true, onSelect: () => onCopyTabPath(tab.path) },
      ],
    });
  }

  function openEditorContextMenu(request: EditorContextMenuRequest) {
    setContextMenu({
      label: "Editor actions",
      x: request.x,
      y: request.y,
      items: [
        { id: "definition", label: "Go to Definition", shortcut: "Ctrl+B", onSelect: () => onEditorGoToDefinition(request) },
        { id: "usages", label: "Find Usages", shortcut: "Ctrl+F7", onSelect: onEditorFindUsages },
        { id: "format", label: "Format Document", shortcut: "Ctrl+Alt+L", separatorBefore: true, onSelect: onEditorFormatDocument },
        { id: "toggle-git-blame", label: gitBlameVisible ? "Disable Git Blame" : "Enable Git Blame", separatorBefore: true, onSelect: onToggleGitBlame },
        { id: "copy-path", label: "Copy File Path", separatorBefore: true, onSelect: onEditorCopyPath },
      ],
    });
  }

  return (
    <main
      aria-label="Editor"
      className={`editor-surface ${surfaceStateClass}${definitionHoverActive ? " editor-surface--definition-hover" : ""}`}
      ref={surfaceRef}
      tabIndex={-1}
    >
      <div className="editor-tabs">
        {openTabs.length > 0 ? (
          openTabs.map((tab, index) => {
            const isActive = activePath === tab.path;

            return (
              <button
                key={tab.path}
                type="button"
                className={`editor-tab${isActive ? " editor-tab--active" : ""}`}
                aria-pressed={isActive}
                title={tab.path}
                onClick={() => onSelectTab(tab.path)}
                onContextMenu={(event) => openTabContextMenu(event, tab, index)}
              >
                {tab.isDirty ? <span className="editor-tab__dirty" aria-hidden="true" /> : null}
                <span className="editor-tab__label">{tab.title}</span>
              </button>
            );
          })
        ) : (
          <button type="button" className="editor-tab editor-tab--active editor-tab--placeholder">
            {workspaceName ?? "Welcome"}
          </button>
        )}
      </div>
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      {activePath ? (
        <LazyArkTsEditor
          appearance={appearance}
          focusToken={focusToken}
          insertTextTarget={insertTextTarget}
          path={activePath}
          selectionTarget={selectionTarget}
          value={content}
          onChange={onChange}
          onCaretRectChange={onCaretRectChange}
          onDefinitionTrigger={onDefinitionTrigger}
          onDefinitionHoverChange={onDefinitionHoverChange}
          onSelectionChange={onSelectionChange}
          onTypingCompletionTrigger={onTypingCompletionTrigger}
          onContextMenu={openEditorContextMenu}
          blameAttributions={blameAttributions}
          gitBlameVisible={gitBlameVisible}
          selectedBlameLine={selectedBlameLine}
          onGitTraceLineClick={onGitTraceLineClick}
        />
      ) : (
        <MainWorkspaceView workspaceName={workspaceName} />
      )}
    </main>
  );
}
