import { Suspense, lazy } from "react";
import type { EditorInsertTextTarget, EditorSelectionTarget } from "@/components/layout/EditorSurface";
import type { DefinitionHoverState, EditorCaretRect, EditorLineColumn } from "@/editor/editor-events";
import type { GitBlameAttribution } from "@/features/git/git-trace-model";
import type { EditorAppearance } from "@/types/editor";

const ArkTsEditor = lazy(async () => {
  const module = await import("@/editor/ArkTsEditor");
  return { default: module.ArkTsEditor };
});

type LazyArkTsEditorProps = {
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
  blameAttributions?: GitBlameAttribution[];
  gitBlameVisible?: boolean;
  selectedBlameLine?: number | null;
  onGitTraceLineClick?: (line: number) => void;
};

export function LazyArkTsEditor(props: LazyArkTsEditorProps) {
  return (
    <Suspense fallback={<div className="editor-loading">Loading editor...</div>}>
      <ArkTsEditor {...props} />
    </Suspense>
  );
}
