import type { EditorInsertTextTarget, EditorSelectionTarget } from "@/components/layout/EditorSurface";
import { useEffect, useRef } from "react";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  appearanceCompartment,
  appearanceExtensionForSettings,
  createEditorExtensions,
  languageCompartment,
  languageExtensionForPath,
} from "@/editor/editor-extensions";
import type { EditorLineColumn } from "@/editor/editor-events";
import type { EditorAppearance } from "@/types/editor";

type ArkTsEditorProps = {
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

export function ArkTsEditor({
  focusToken = 0,
  path,
  value,
  appearance,
  selectionTarget = null,
  insertTextTarget = null,
  onChange,
  onSelectionChange,
  onDefinitionTrigger,
}: ArkTsEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onDefinitionTriggerRef = useRef(onDefinitionTrigger);

  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;
  onDefinitionTriggerRef.current = onDefinitionTrigger;

  useEffect(() => {
    if (!hostRef.current || viewRef.current) {
      return;
    }

    const state = EditorState.create({
      doc: value,
      extensions: createEditorExtensions(
        path,
        appearance,
        (nextValue) => onChangeRef.current(nextValue),
        (selection) => onSelectionChangeRef.current?.(selection),
        () => onDefinitionTriggerRef.current?.(),
      ),
    });

    viewRef.current = new EditorView({
      state,
      parent: hostRef.current,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue !== value) {
      const selection = view.state.selection.main;
      const anchor = Math.min(selection.anchor, value.length);
      const head = Math.min(selection.head, value.length);

      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
        selection: EditorSelection.range(anchor, head),
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: languageCompartment.reconfigure(languageExtensionForPath(path)),
    });
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: appearanceCompartment.reconfigure(appearanceExtensionForSettings(appearance)),
    });
  }, [appearance, path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !selectionTarget) {
      return;
    }

    const targetLine = Math.min(Math.max(selectionTarget.line, 1), view.state.doc.lines);
    const line = view.state.doc.line(targetLine);
    const targetColumn = Math.max(selectionTarget.column, 1);
    const position = Math.min(line.from + targetColumn - 1, line.to);

    view.dispatch({
      selection: EditorSelection.cursor(position),
      scrollIntoView: true,
    });
    view.focus();
  }, [selectionTarget]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !insertTextTarget) {
      return;
    }

    view.dispatch(view.state.replaceSelection(insertTextTarget.text));
    view.focus();
  }, [insertTextTarget]);

  useEffect(() => {
    viewRef.current?.focus();
  }, [focusToken]);

  return <div className="editor-codemirror" ref={hostRef} />;
}
