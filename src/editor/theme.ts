import type { EditorAppearance } from "@/types/editor";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export const arkLineHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#7db3ff" },
  { tag: [tags.string, tags.special(tags.string)], color: "#a6dc8f" },
  { tag: [tags.number, tags.bool, tags.null], color: "#f0c674" },
  { tag: tags.comment, color: "#7f8b99" },
  { tag: tags.definition(tags.variableName), color: "#e7edf6" },
  { tag: tags.typeName, color: "#73d0ff" },
]);

export function createArkLineEditorTheme(appearance: EditorAppearance) {
  return EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "var(--bg-editor)",
      color: "#d7dae0",
      fontFamily: appearance.fontFamily,
      fontSize: `${appearance.fontSize}px`,
      lineHeight: `${appearance.lineHeight}`,
    },
    ".cm-scroller": {
      fontFamily: appearance.fontFamily,
      overflow: "auto",
    },
    ".cm-content": {
      caretColor: "var(--text-primary)",
      padding: "0 18px 0 0",
      letterSpacing: `${appearance.letterSpacing}px`,
      userSelect: "text",
      WebkitUserSelect: "text",
    },
    ".cm-line": {
      userSelect: "text",
      WebkitUserSelect: "text",
    },
    ".cm-arkline-definition-hover": {
      textDecoration: "underline",
      textDecorationColor: "color-mix(in srgb, var(--accent-blue, #4c8dff) 60%, transparent)",
      textUnderlineOffset: "0.14em",
    },
    ".cm-arkline-jump-reveal": {
      backgroundColor: "rgb(76 141 255 / 0.2)",
      borderRadius: "3px",
      boxShadow: "0 0 0 1px rgb(76 141 255 / 0.18)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg-editor)",
      color: "#5f6670",
      borderRight: "0",
      paddingRight: "16px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "32px",
      textAlign: "right",
    },
    ".cm-activeLine": {
      backgroundColor: "rgb(255 255 255 / 0.03)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "#7a828d",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "rgb(87 151 255 / 0.32)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--text-primary)",
    },
  }, { dark: true });
}

export const arkLineSyntaxTheme = syntaxHighlighting(arkLineHighlightStyle);
