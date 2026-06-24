import type { DefinitionHoverState, EditorLineColumn } from "@/editor/editor-events";
import type { GitBlameAttribution } from "@/features/git/git-trace-model";
import type { RefObject } from "react";
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
  onSelectionChange: (selection: { line: number; column: number }) => void;
  onDefinitionTrigger?: (selection?: EditorLineColumn) => void;
  onDefinitionHoverChange?: (state: DefinitionHoverState) => void;
  onTypingCompletionTrigger?: (selection: EditorLineColumn) => void;
  blameAttributions?: GitBlameAttribution[];
  selectedBlameLine?: number | null;
  onGitTraceLineClick?: (line: number) => void;
  definitionHoverActive?: boolean;
  onSelectTab: (path: string) => void;
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
  onDefinitionTrigger,
  onDefinitionHoverChange,
  onTypingCompletionTrigger,
  blameAttributions = [],
  selectedBlameLine = null,
  onGitTraceLineClick,
  definitionHoverActive = false,
  onSelectTab,
}: EditorSurfaceProps) {
  const surfaceStateClass = activePath ? "editor-surface--active" : "editor-surface--empty";
  return (
    <main
      aria-label="Editor"
      className={`editor-surface ${surfaceStateClass}${definitionHoverActive ? " editor-surface--definition-hover" : ""}`}
      ref={surfaceRef}
      tabIndex={-1}
    >
      <div className="editor-tabs">
        {openTabs.length > 0 ? (
          openTabs.map((tab) => {
            const isActive = activePath === tab.path;

            return (
              <button
                key={tab.path}
                type="button"
                className={`editor-tab${isActive ? " editor-tab--active" : ""}`}
                aria-pressed={isActive}
                title={tab.path}
                onClick={() => onSelectTab(tab.path)}
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
      {activePath ? (
        <LazyArkTsEditor
          appearance={appearance}
          focusToken={focusToken}
          insertTextTarget={insertTextTarget}
          path={activePath}
          selectionTarget={selectionTarget}
          value={content}
          onChange={onChange}
          onDefinitionTrigger={onDefinitionTrigger}
          onDefinitionHoverChange={onDefinitionHoverChange}
          onSelectionChange={onSelectionChange}
          onTypingCompletionTrigger={onTypingCompletionTrigger}
          blameAttributions={blameAttributions}
          selectedBlameLine={selectedBlameLine}
          onGitTraceLineClick={onGitTraceLineClick}
        />
      ) : (
        <MainWorkspaceView workspaceName={workspaceName} />
      )}
    </main>
  );
}
