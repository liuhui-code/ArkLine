import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { searchKeymap } from "@codemirror/search";
import { Compartment, Extension } from "@codemirror/state";
import {
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { createDefinitionTriggerHandler, createDocumentChangeListener, createSelectionChangeListener, type EditorLineColumn } from "@/editor/editor-events";
import { arkLineSyntaxTheme, createArkLineEditorTheme } from "@/editor/theme";
import type { EditorAppearance, EditorDocumentKind } from "@/types/editor";

export const languageCompartment = new Compartment();
export const appearanceCompartment = new Compartment();

export function appearanceExtensionForSettings(appearance: EditorAppearance): Extension {
  return createArkLineEditorTheme(appearance);
}

export function detectDocumentKind(path: string): EditorDocumentKind {
  const lower = path.toLowerCase();

  if (lower.endsWith(".ets")) {
    return "arkts";
  }

  if (lower.endsWith(".ts")) {
    return "typescript";
  }

  if (lower.endsWith(".json5")) {
    return "json5";
  }

  return "plain";
}

export function languageExtensionForPath(path: string): Extension {
  const kind = detectDocumentKind(path);

  if (kind === "arkts" || kind === "typescript") {
    return javascript({ typescript: true });
  }

  if (kind === "json5") {
    return json();
  }

  return [];
}

export function createEditorExtensions(
  path: string,
  appearance: EditorAppearance,
  onChange: (value: string) => void,
  onSelectionChange?: (selection: { line: number; column: number }) => void,
  onDefinitionTrigger?: (selection?: EditorLineColumn) => void,
): Extension[] {
  return [
    EditorView.contentAttributes.of({
      "aria-label": "Editor Content",
      spellcheck: "false",
    }),
    lineNumbers(),
    highlightActiveLineGutter(),
    dropCursor(),
    rectangularSelection(),
    history(),
    foldGutter(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    keymap.of([
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
    ]),
    createDocumentChangeListener(onChange),
    ...(onSelectionChange ? [createSelectionChangeListener(onSelectionChange)] : []),
    ...(onDefinitionTrigger ? [createDefinitionTriggerHandler(onDefinitionTrigger)] : []),
    arkLineSyntaxTheme,
    appearanceCompartment.of(appearanceExtensionForSettings(appearance)),
    languageCompartment.of(languageExtensionForPath(path)),
  ];
}
