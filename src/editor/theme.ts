import type { EditorAppearance } from "@/types/editor";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const editorPalette = {
  background: "#1f2329",
  foreground: "#d6deeb",
  foregroundMuted: "#8b949e",
  gutter: "#252a31",
  gutterText: "#68717d",
  gutterActive: "#b7c2d0",
  lineActive: "rgba(72, 95, 126, 0.22)",
  lineActiveBorder: "rgba(88, 166, 255, 0.44)",
  selection: "rgba(62, 125, 208, 0.36)",
  selectionMatch: "rgba(88, 166, 255, 0.16)",
  searchMatch: "rgba(255, 212, 92, 0.32)",
  searchSelected: "rgba(255, 212, 92, 0.48)",
  cursor: "#f0f6fc",
  keyword: "#c792ea",
  control: "#82aaff",
  string: "#a5d6a7",
  number: "#ffcb6b",
  comment: "#768390",
  type: "#89ddff",
  function: "#dcdcaa",
  property: "#9cdcfe",
  variable: "#d6deeb",
  operator: "#89ddff",
  punctuation: "#8b949e",
  decorator: "#f78c6c",
  invalid: "#ff7b72",
  warning: "#d29922",
};

export const arkLineHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: editorPalette.comment, fontStyle: "italic" },
  { tag: [tags.keyword, tags.definitionKeyword, tags.moduleKeyword], color: editorPalette.keyword },
  { tag: [tags.controlKeyword, tags.operatorKeyword, tags.self], color: editorPalette.control },
  { tag: tags.modifier, color: editorPalette.keyword },
  { tag: [tags.string, tags.special(tags.string), tags.docString, tags.regexp], color: editorPalette.string },
  { tag: [tags.escape, tags.character, tags.attributeValue], color: editorPalette.decorator },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom], color: editorPalette.number },
  { tag: [tags.typeName, tags.className, tags.tagName, tags.namespace], color: editorPalette.type },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: editorPalette.function },
  { tag: [tags.propertyName, tags.attributeName], color: editorPalette.property },
  { tag: tags.definition(tags.variableName), color: editorPalette.variable },
  { tag: tags.variableName, color: editorPalette.variable },
  { tag: [tags.operator, tags.derefOperator, tags.compareOperator, tags.logicOperator], color: editorPalette.operator },
  { tag: [tags.punctuation, tags.separator, tags.bracket], color: editorPalette.punctuation },
  { tag: [tags.meta, tags.macroName, tags.labelName], color: editorPalette.decorator },
  { tag: tags.invalid, color: editorPalette.invalid, textDecoration: "underline wavy #ff7b72" },
]);

export function createArkLineEditorTheme(appearance: EditorAppearance) {
  return EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: editorPalette.background,
      color: editorPalette.foreground,
      fontFamily: appearance.fontFamily,
      fontSize: `${appearance.fontSize}px`,
      lineHeight: `${appearance.lineHeight}`,
    },
    "&.cm-focused": {
      outline: "none",
    },
    "&.cm-focused .cm-scroller": {
      boxShadow: "inset 0 0 0 1px rgba(88, 166, 255, 0.08)",
    },
    ".cm-scroller": {
      fontFamily: appearance.fontFamily,
      overflow: "auto",
      backgroundColor: editorPalette.background,
      scrollbarColor: "rgba(139, 148, 158, 0.38) transparent",
      scrollbarWidth: "thin",
    },
    ".cm-scroller::-webkit-scrollbar": {
      width: "11px",
      height: "11px",
    },
    ".cm-scroller::-webkit-scrollbar-thumb": {
      border: "3px solid transparent",
      borderRadius: "999px",
      backgroundClip: "content-box",
      backgroundColor: "rgba(139, 148, 158, 0.32)",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": {
      backgroundColor: "rgba(139, 148, 158, 0.5)",
    },
    ".cm-scroller::-webkit-scrollbar-corner": {
      backgroundColor: "transparent",
    },
    ".cm-content": {
      caretColor: editorPalette.cursor,
      padding: "0 22px 0 0",
      letterSpacing: `${appearance.letterSpacing}px`,
      minWidth: "max-content",
      outline: "none",
      userSelect: "text",
      WebkitUserSelect: "text",
    },
    ".cm-line": {
      padding: "0 16px 0 0",
      userSelect: "text",
      WebkitUserSelect: "text",
    },
    ".cm-arkline-definition-hover": {
      textDecoration: "underline",
      textDecorationColor: "rgba(88, 166, 255, 0.78)",
      textUnderlineOffset: "0.14em",
      textDecorationThickness: "1px",
    },
    ".cm-arkline-jump-reveal": {
      backgroundColor: "rgba(88, 166, 255, 0.22)",
      borderRadius: "3px",
      boxShadow: "0 0 0 1px rgba(88, 166, 255, 0.34)",
    },
    ".cm-gutters": {
      backgroundColor: editorPalette.gutter,
      color: editorPalette.gutterText,
      borderRight: "1px solid rgba(125, 133, 144, 0.16)",
      paddingRight: "12px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "32px",
      textAlign: "right",
    },
    ".cm-gutterElement": {
      borderRadius: "4px",
    },
    ".cm-gutterElement:hover": {
      color: editorPalette.gutterActive,
    },
    ".cm-foldGutter .cm-gutterElement": {
      color: "rgba(139, 148, 158, 0.72)",
      cursor: "default",
    },
    ".cm-activeLine": {
      backgroundColor: editorPalette.lineActive,
      boxShadow: `inset 2px 0 0 ${editorPalette.lineActiveBorder}`,
    },
    ".cm-activeLineGutter": {
      backgroundColor: editorPalette.lineActive,
      color: editorPalette.gutterActive,
      fontWeight: "600",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: editorPalette.selection,
    },
    ".cm-selectionMatch": {
      backgroundColor: editorPalette.selectionMatch,
      borderRadius: "3px",
    },
    ".cm-searchMatch": {
      backgroundColor: editorPalette.searchMatch,
      borderRadius: "3px",
      outline: "1px solid rgba(255, 212, 92, 0.2)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: editorPalette.searchSelected,
      outlineColor: "rgba(255, 212, 92, 0.44)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: editorPalette.cursor,
      borderLeftWidth: "2px",
    },
    ".cm-dropCursor": {
      borderLeftStyle: "solid",
    },
    ".cm-matchingBracket": {
      backgroundColor: "rgba(88, 166, 255, 0.18)",
      boxShadow: "0 0 0 1px rgba(88, 166, 255, 0.36)",
      borderRadius: "3px",
      color: editorPalette.foreground,
    },
    ".cm-nonmatchingBracket": {
      backgroundColor: "rgba(248, 81, 73, 0.18)",
      color: editorPalette.invalid,
      borderRadius: "3px",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "rgba(110, 118, 129, 0.18)",
      border: "1px solid rgba(110, 118, 129, 0.28)",
      borderRadius: "4px",
      color: editorPalette.foregroundMuted,
      padding: "0 6px",
    },
    ".cm-placeholder": {
      color: "rgba(139, 148, 158, 0.62)",
      fontStyle: "italic",
    },
    ".cm-panels": {
      backgroundColor: "transparent",
      borderColor: "rgba(125, 133, 144, 0.18)",
      color: editorPalette.foreground,
    },
    ".cm-panels-top": {
      borderBottom: "0",
    },
    ".cm-panel.cm-search": {
      display: "grid",
      gridTemplateColumns: "minmax(190px, 1fr) auto auto auto auto",
      gridTemplateRows: "32px 30px 22px",
      alignItems: "center",
      columnGap: "5px",
      rowGap: "5px",
      width: "min(620px, calc(100% - 28px))",
      minHeight: "96px",
      margin: "8px 14px 0 auto",
      padding: "7px 8px 8px",
      backgroundColor: "#2b3038",
      border: "1px solid rgba(125, 133, 144, 0.28)",
      borderRadius: "7px",
      boxShadow: "0 10px 26px rgba(0, 0, 0, 0.26)",
      color: editorPalette.foreground,
      fontFamily: "inherit",
      fontSize: "12px",
    },
    ".cm-panel.cm-search label": {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      color: editorPalette.foregroundMuted,
      whiteSpace: "nowrap",
      fontSize: "11px",
    },
    ".cm-panels input": {
      backgroundColor: "#1f2329",
      border: "1px solid rgba(125, 133, 144, 0.28)",
      borderRadius: "5px",
      color: editorPalette.foreground,
      fontFamily: "inherit",
      fontSize: "12px",
      height: "24px",
      outline: "none",
      padding: "0 7px",
    },
    ".cm-panel.cm-search input[name=search]": {
      width: "auto",
      minWidth: "0",
      gridColumn: "1",
      gridRow: "1",
    },
    ".cm-panel.cm-search input[name=replace]": {
      width: "auto",
      minWidth: "0",
      gridColumn: "1",
      gridRow: "2",
    },
    ".cm-panels input:focus": {
      borderColor: "rgba(88, 166, 255, 0.62)",
      boxShadow: "0 0 0 2px rgba(88, 166, 255, 0.14)",
    },
    ".cm-panel.cm-search button": {
      height: "24px",
      minWidth: "30px",
      padding: "0 7px",
      backgroundColor: "#333944",
      border: "1px solid rgba(125, 133, 144, 0.24)",
      borderRadius: "5px",
      color: editorPalette.foreground,
      cursor: "default",
      fontFamily: "inherit",
      fontSize: "12px",
    },
    ".cm-panel.cm-search button:hover": {
      backgroundColor: "#3b4350",
      borderColor: "rgba(125, 133, 144, 0.38)",
    },
    ".cm-panel.cm-search button:focus-visible": {
      borderColor: "rgba(88, 166, 255, 0.62)",
      outline: "none",
      boxShadow: "0 0 0 2px rgba(88, 166, 255, 0.14)",
    },
    ".cm-panel.cm-search button[name=close]": {
      gridColumn: "5",
      gridRow: "1",
      minWidth: "26px",
      padding: "0",
      backgroundColor: "transparent",
      borderColor: "transparent",
      color: editorPalette.foregroundMuted,
      fontSize: "15px",
    },
    ".cm-panel.cm-search button[name=close]:hover": {
      backgroundColor: "rgba(125, 133, 144, 0.14)",
      color: editorPalette.foreground,
    },
    ".cm-panel.cm-search input[type=checkbox]": {
      width: "13px",
      height: "13px",
      accentColor: "#4c8ed9",
    },
    ".cm-panel.cm-search button[name=next]": {
      gridColumn: "3",
      gridRow: "1",
    },
    ".cm-panel.cm-search button[name=prev]": {
      gridColumn: "2",
      gridRow: "1",
    },
    ".cm-panel.cm-search button[name=select]": {
      gridColumn: "4",
      gridRow: "1",
    },
    ".cm-panel.cm-search button[name=replace]": {
      gridColumn: "2",
      gridRow: "2",
    },
    ".cm-panel.cm-search button[name=replaceAll]": {
      gridColumn: "3",
      gridRow: "2",
    },
    ".cm-panel.cm-search label:nth-of-type(1)": {
      gridColumn: "1",
      gridRow: "3",
      justifySelf: "start",
    },
    ".cm-panel.cm-search label:nth-of-type(2)": {
      gridColumn: "2",
      gridRow: "3",
    },
    ".cm-panel.cm-search label:nth-of-type(3)": {
      gridColumn: "3",
      gridRow: "3",
    },
    ".cm-panel.cm-search br": {
      display: "none",
    },
    ".cm-search-match-count": {
      gridColumn: "1",
      gridRow: "1",
      justifySelf: "end",
      marginRight: "7px",
      color: editorPalette.foregroundMuted,
      fontSize: "11px",
      pointerEvents: "none",
    },
    ".cm-panel.cm-search [aria-live]": {
      minWidth: "52px",
      color: editorPalette.foregroundMuted,
      fontSize: "11px",
      textAlign: "right",
    },
    ".cm-tooltip": {
      border: "1px solid rgba(125, 133, 144, 0.24)",
      borderRadius: "7px",
      backgroundColor: "#252a31",
      color: editorPalette.foreground,
      boxShadow: "0 16px 40px rgba(0, 0, 0, 0.34)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "rgba(88, 166, 255, 0.18)",
      color: editorPalette.foreground,
    },
    ".cm-diagnostic": {
      borderLeft: "3px solid rgba(125, 133, 144, 0.38)",
      paddingLeft: "8px",
    },
    ".cm-diagnostic-error": {
      borderLeftColor: editorPalette.invalid,
    },
    ".cm-diagnostic-warning": {
      borderLeftColor: editorPalette.warning,
    },
    ".cm-lintRange-error": {
      backgroundImage: "linear-gradient(45deg, transparent 65%, rgba(255, 123, 114, 0.9) 65%)",
      backgroundPosition: "0 100%",
      backgroundRepeat: "repeat-x",
      backgroundSize: "6px 3px",
    },
    ".cm-lintRange-warning": {
      backgroundImage: "linear-gradient(45deg, transparent 65%, rgba(210, 153, 34, 0.9) 65%)",
      backgroundPosition: "0 100%",
      backgroundRepeat: "repeat-x",
      backgroundSize: "6px 3px",
    },
  }, { dark: true });
}

export const arkLineSyntaxTheme = syntaxHighlighting(arkLineHighlightStyle);
