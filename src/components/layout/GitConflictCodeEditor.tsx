import { useEffect, useRef } from "react";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { languageExtensionForPath } from "@/editor/editor-extensions";
import { arkLineSyntaxTheme, createArkLineEditorTheme } from "@/editor/theme";

type GitConflictCodeEditorProps = {
  ariaLabel: string;
  value: string;
  original: string | null;
  relativePath: string;
  readOnly: boolean;
  activeOffset?: number | null;
  onChange?: (value: string) => void;
};

const conflictAppearance = {
  fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace",
  fontSize: 11,
  lineHeight: 1.55,
  letterSpacing: 0,
};

export function GitConflictCodeEditor({
  ariaLabel,
  value,
  original,
  relativePath,
  readOnly,
  activeOffset = null,
  onChange,
}: GitConflictCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const applyingExternalValueRef = useRef(false);
  const pendingLocalValuesRef = useRef(new Set<string>());
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const extensions: Extension[] = [
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.contentAttributes.of({
        "aria-label": ariaLabel,
        "aria-readonly": String(readOnly),
        spellcheck: "false",
      }),
      lineNumbers(),
      arkLineSyntaxTheme,
      createArkLineEditorTheme(conflictAppearance),
      languageExtensionForPath(relativePath),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applyingExternalValueRef.current) {
          const nextValue = update.state.doc.toString();
          pendingLocalValuesRef.current.add(nextValue);
          onChangeRef.current?.(nextValue);
        }
      }),
    ];
    if (original !== null) {
      extensions.push(unifiedMergeView({
        original,
        mergeControls: false,
        gutter: true,
        highlightChanges: true,
        allowInlineDiffs: true,
        diffConfig: { scanLimit: 1_000 },
      }));
    }
    const view = new EditorView({ doc: value, extensions, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
  }, [ariaLabel, original, readOnly, relativePath]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      pendingLocalValuesRef.current.clear();
      return;
    }
    if (pendingLocalValuesRef.current.delete(value)) return;
    applyingExternalValueRef.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    applyingExternalValueRef.current = false;
    pendingLocalValuesRef.current.clear();
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || activeOffset === null) return;
    const position = Math.min(activeOffset, view.state.doc.length);
    view.dispatch({ effects: EditorView.scrollIntoView(position, { y: "center" }) });
  }, [activeOffset, value]);

  return <div className="git-conflict-code-editor" ref={hostRef} />;
}
