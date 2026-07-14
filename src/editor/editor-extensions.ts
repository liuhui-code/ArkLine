import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { openSearchPanel, searchKeymap } from "@codemirror/search";
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
import { searchPanelEnhancement } from "@/editor/search-panel";
import type { GitBlameAttribution } from "@/features/git/git-trace-model";
import type { EditorAppearance, EditorDocumentKind } from "@/types/editor";

export const languageCompartment = new Compartment();
export const appearanceCompartment = new Compartment();
export const gitTraceCompartment = new Compartment();
export const editorStructureCompartment = new Compartment();

function openReplacePanel(view: EditorView) {
  const opened = openSearchPanel(view);
  window.setTimeout(() => {
    const replaceInput = view.dom.querySelector<HTMLInputElement>('input[name="replace"]');
    replaceInput?.focus();
    replaceInput?.select();
  }, 0);
  return opened;
}

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
  const keymaps = largeDocumentMode
    ? [indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap, { key: "Mod-r", run: openReplacePanel, scope: "editor search-panel" }]
    : [indentWithTab, ...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, { key: "Mod-r", run: openReplacePanel, scope: "editor search-panel" }];

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
    jumpRevealDecorationField,
    ...(largeDocumentMode ? [] : [definitionHoverDecorationField]),
    keymap.of(keymaps),
    searchPanelEnhancement,
    createDocumentChangeListener(onChange, largeDocumentMode),
    ...(onSelectionChange ? [createSelectionChangeListener(onSelectionChange)] : []),
    ...(onDefinitionTrigger ? [createDefinitionTriggerHandler(onDefinitionTrigger)] : []),
    ...(!largeDocumentMode && onDefinitionHoverChange ? [createDefinitionHoverHandler(onDefinitionHoverChange)] : []),
    ...(!largeDocumentMode && onTypingCompletionTrigger ? [createTypingCompletionTriggerListener(onTypingCompletionTrigger)] : []),
    ...(onContextMenu ? [createEditorContextMenuHandler(onContextMenu)] : []),
    arkLineSyntaxTheme,
    appearanceCompartment.of(appearanceExtensionForSettings(appearance)),
    editorStructureCompartment.of(structureExtensionForDocument(largeDocumentMode)),
    languageCompartment.of(languageExtensionForPath(path, largeDocumentMode)),
    gitTraceCompartment.of(gitTrace && !largeDocumentMode ? createGitTraceGutter(gitTrace) : []),
  ];
}
