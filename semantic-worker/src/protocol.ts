export interface SemanticDocumentPosition {
  path: string
  line: number
  column: number
  content?: string
  contentGeneration?: number
  workspaceRoot?: string
}

export interface SemanticReplayDocument {
  path: string
  content: string
  contentGeneration: number
}

export interface SemanticResponseState {
  path: string
  contentGeneration: number
  dependencyGeneration: number
  documentCacheHit: boolean
  queryCacheHit: boolean
  loadedDocumentCount: number
  syntaxReady: boolean
  typeStatus?: "ready" | "partial" | "unsupported"
  typeEngine?: string
  typeEngineVersion?: string
  typeGeneration?: number
}

export interface SemanticRuntimeState {
  rssBytes: number
  heapUsedBytes: number
  heapTotalBytes: number
  externalBytes: number
  uptimeMs: number
}

export const SEMANTIC_PROTOCOL_VERSION = 3

export type SemanticRequestMethod =
  | "health"
  | "restoreDocuments"
  | "gotoDefinition"
  | "completion"
  | "listCodeActions"
  | "resolveCodeAction"
  | "prepareRename"
  | "rename"

export interface SemanticRequest {
  id: string
  method: SemanticRequestMethod
  position?: SemanticDocumentPosition
  action?: SemanticCodeActionRequest
  newName?: string
  documents?: SemanticReplayDocument[]
}

export interface SemanticCompletionItem {
  label: string
  detail: string
  kind: string
  insertText?: string
  filterText?: string
  sortText?: string
  source?: "workspace" | "arkts" | "arkui" | "sdk" | "type" | "fallback"
  documentation?: string
  replacementRange?: SemanticTextRange
  commitCharacters?: string[]
  definitionTarget?: SemanticDefinitionTarget
  data?: Record<string, unknown>
}

export interface SemanticDefinitionTarget {
  path: string
  line: number
  column: number
}

export interface SemanticTextRange {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export interface SemanticDefinitionCandidate extends SemanticDefinitionTarget {}

export type SemanticCodeActionKind =
  | "quickfix"
  | "refactor.extract"
  | "refactor.inline"
  | "refactor.rewrite"
  | "source"
  | "generate"
  | "template"

export type SemanticCodeActionSafety = "safe" | "needsPreview" | "risky"

export interface SemanticCodeAction {
  id: string
  title: string
  kind: SemanticCodeActionKind
  provider: "arkts" | "workspace" | "template" | "fallback"
  safety: SemanticCodeActionSafety
  disabledReason?: string
  editId?: string
  data?: Record<string, unknown>
}

export interface SemanticCodeActionRequest {
  id: string
  data?: Record<string, unknown>
}

export interface SemanticCodeActionList {
  actions: SemanticCodeAction[]
}

export interface SemanticEditConflict {
  path: string
  message: string
}

export type SemanticWorkspaceEditOperation =
  | {
      kind: "text"
      path: string
      range: SemanticTextRange
      newText: string
      expectedVersion?: number
    }
  | { kind: "createFile"; path: string; content: string; overwrite: boolean }
  | { kind: "renameFile"; oldPath: string; newPath: string; overwrite: boolean }
  | { kind: "deleteFile"; path: string; recursive: boolean }

export interface SemanticWorkspaceEditPlan {
  id: string
  title: string
  operations: SemanticWorkspaceEditOperation[]
  conflicts: SemanticEditConflict[]
  affectedFiles: string[]
  undoLabel: string
  requiresPreview: boolean
}

export interface SemanticPrepareRenameResult {
  range: SemanticTextRange
  placeholder: string
}

export interface SemanticUnsupportedResult {
  status: "unsupported"
  reason: string
}

export type SemanticResponsePayload =
  | { status: "ready"; protocolVersion: number; capabilities: string[] }
  | { restoredDocumentCount: number }
  | SemanticDefinitionTarget
  | { definition: SemanticDefinitionTarget | null; definitionCandidates?: SemanticDefinitionCandidate[] }
  | SemanticCompletionItem[]
  | SemanticCodeActionList
  | SemanticWorkspaceEditPlan
  | SemanticPrepareRenameResult
  | SemanticUnsupportedResult
  | null

export interface SemanticResponse {
  id: string
  ok: boolean
  payload: SemanticResponsePayload
  state?: SemanticResponseState
  runtime?: SemanticRuntimeState
  error?: string
}
