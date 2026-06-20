import { Suspense, lazy } from "react";
import type { EditorInsertTextTarget, EditorSelectionTarget } from "@/components/layout/EditorSurface";
import type { EditorLineColumn } from "@/editor/editor-events";
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
  onSelectionChange?: (selection: { line: number; column: number }) => void;
  onDefinitionTrigger?: (selection?: EditorLineColumn) => void;
};

export function LazyArkTsEditor(props: LazyArkTsEditorProps) {
  return (
    <Suspense fallback={<div className="editor-loading">Loading editor...</div>}>
      <ArkTsEditor {...props} />
    </Suspense>
  );
}
