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
import {
  createDefinitionHoverHandler,
  createDefinitionTriggerHandler,
  createDocumentChangeListener,
  createEditorContextMenuHandler,
  createSelectionChangeListener,
  createTypingCompletionTriggerListener,
  definitionHoverDecorationField,
  jumpRevealDecorationField,
  type DefinitionHoverState,
  type EditorContextMenuRequest,
  type EditorLineColumn,
} from "@/editor/editor-events";
import { createGitTraceGutter } from "@/editor/git-trace-decorations";
import { arkLineSyntaxTheme, createArkLineEditorTheme } from "@/editor/theme";
import type { GitBlameAttribution } from "@/features/git/git-trace-model";
import type { EditorAppearance, EditorDocumentKind } from "@/types/editor";

export const languageCompartment = new Compartment();
export const appearanceCompartment = new Compartment();
export const gitTraceCompartment = new Compartment();
export const editorStructureCompartment = new Compartment();

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

export function languageExtensionForPath(path: string, largeDocumentMode = false): Extension {
  if (largeDocumentMode) {
    return [];
  }

  const kind = detectDocumentKind(path);

  if (kind === "arkts" || kind === "typescript") {
    return javascript({ typescript: true });
  }

  if (kind === "json5") {
    return json();
  }

  return [];
}

export function structureExtensionForDocument(largeDocumentMode = false): Extension {
  if (largeDocumentMode) {
    return [bracketMatching()];
  }

  return [
    foldGutter(),
    indentOnInput(),
    bracketMatching(),
  ];
}

export function createEditorExtensions(
  path: string,
  appearance: EditorAppearance,
  onChange: (value: string) => void,
  onSelectionChange?: (selection: { line: number; column: number; selectedText?: string }) => void,
  onDefinitionTrigger?: (selection?: EditorLineColumn) => void,
  onDefinitionHoverChange?: (state: DefinitionHoverState) => void,
  onTypingCompletionTrigger?: (selection: EditorLineColumn) => void,
  onContextMenu?: (request: EditorContextMenuRequest) => void,
  gitTrace?: {
    blameAttributions: GitBlameAttribution[];
    selectedLine: number | null;
    onSelectLine?: (line: number) => void;
  },
  largeDocumentMode = false,
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
    highlightActiveLine(),
    definitionHoverDecorationField,
    jumpRevealDecorationField,
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
    ...(onDefinitionHoverChange ? [createDefinitionHoverHandler(onDefinitionHoverChange)] : []),
    ...(onTypingCompletionTrigger ? [createTypingCompletionTriggerListener(onTypingCompletionTrigger)] : []),
    ...(onContextMenu ? [createEditorContextMenuHandler(onContextMenu)] : []),
    arkLineSyntaxTheme,
    appearanceCompartment.of(appearanceExtensionForSettings(appearance)),
    editorStructureCompartment.of(structureExtensionForDocument(largeDocumentMode)),
    languageCompartment.of(languageExtensionForPath(path, largeDocumentMode)),
    gitTraceCompartment.of(gitTrace ? createGitTraceGutter(gitTrace) : []),
  ];
}
