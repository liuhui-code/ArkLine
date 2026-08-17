import type { EditorCompletionTarget, EditorInsertTextTarget, EditorSelectionTarget } from "@/components/layout/EditorSurface";
import type { CodeMirrorCompletionBroker, CodeMirrorCompletionResolver } from "@/editor/codemirror-completion-source";
import type { CodeMirrorSignatureHelpBroker } from "@/editor/codemirror-signature-help";
import type {
  DefinitionHoverState,
  EditorCaretRect,
  EditorContextMenuRequest,
  EditorLineColumn,
} from "@/editor/editor-events";
import type { EditorValidationRequest, EditorValidationResultHandler } from "@/editor/editor-validation-lint";
import type { GitBlameAttribution } from "@/features/git/git-trace-model";
import type { EditorAppearance } from "@/types/editor";
import type { Text } from "@codemirror/state";

export type ArkTsEditorProps = {
  focusToken?: number;
  completionTarget?: EditorCompletionTarget | null;
  completionEnabled?: boolean;
  path: string;
  value?: string;
  document?: Text;
  appearance: EditorAppearance;
  selectionTarget?: EditorSelectionTarget | null;
  insertTextTarget?: EditorInsertTextTarget | null;
  onChange: (value: string) => void;
  onDocumentChange?: (document: Text) => void;
  onSelectionChange?: (selection: { line: number; column: number; selectedText?: string }) => void;
  onCaretRectChange?: (rect: EditorCaretRect) => void;
  onDefinitionTrigger?: (selection?: EditorLineColumn) => void;
  onDefinitionHoverChange?: (state: DefinitionHoverState) => void;
  onTypingCompletionTrigger?: (selection: EditorLineColumn) => void;
  onCodeMirrorCompletionRequest?: CodeMirrorCompletionBroker;
  onCodeMirrorCompletionResolve?: CodeMirrorCompletionResolver;
  onCodeMirrorSignatureHelpRequest?: CodeMirrorSignatureHelpBroker;
  onValidationRequest?: EditorValidationRequest;
  onValidationResult?: EditorValidationResultHandler;
  onContextMenu?: (request: EditorContextMenuRequest) => void;
  blameAttributions?: GitBlameAttribution[];
  gitBlameVisible?: boolean;
  selectedBlameLine?: number | null;
  onGitTraceLineClick?: (line: number) => void;
  transientPreview?: boolean;
};
