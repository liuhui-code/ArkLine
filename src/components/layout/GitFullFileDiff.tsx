import { useEffect, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { languageExtensionForPath } from "@/editor/editor-extensions";
import { arkLineSyntaxTheme, createArkLineEditorTheme } from "@/editor/theme";
import type { GitFileComparison } from "@/features/git/git-source-control-model";

type GitFullFileDiffProps = {
  comparison: GitFileComparison;
  activeDifference: number;
};

const diffAppearance = {
  fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace",
  fontSize: 11,
  lineHeight: 1.55,
  letterSpacing: 0,
};

export function GitFullFileDiff({ comparison, activeDifference }: GitFullFileDiffProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView | null>(null);
  const beforeLabel = comparison.staged ? "HEAD" : "Index";
  const afterLabel = comparison.staged ? "Index" : "Working Tree";

  useEffect(() => {
    if (!hostRef.current) return;
    const extensions: Extension[] = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      lineNumbers(),
      arkLineSyntaxTheme,
      createArkLineEditorTheme(diffAppearance),
      languageExtensionForPath(comparison.relativePath),
    ];
    const view = new MergeView({
      a: { doc: comparison.before.content ?? "", extensions },
      b: { doc: comparison.after.content ?? "", extensions },
      parent: hostRef.current,
      orientation: "a-b",
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 8 },
      diffConfig: { scanLimit: 1_000 },
    });
    mergeRef.current = view;
    return () => {
      view.destroy();
      if (mergeRef.current === view) mergeRef.current = null;
    };
  }, [comparison]);

  useEffect(() => {
    const view = mergeRef.current;
    if (!view?.chunks?.length) return;
    const chunk = view.chunks[Math.min(activeDifference, view.chunks.length - 1)];
    const position = Math.min(chunk.fromB, view.b.state.doc.length);
    view.b.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: "center" }),
    });
  }, [activeDifference, comparison]);

  return (
    <section className="git-full-diff" aria-label="Full file comparison">
      <header className="git-full-diff__header"><span>{beforeLabel}</span><span>{afterLabel}</span></header>
      <div className="git-full-diff__host" ref={hostRef} />
    </section>
  );
}
