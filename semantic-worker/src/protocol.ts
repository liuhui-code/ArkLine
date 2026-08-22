export interface SemanticDocumentPosition {
  path: string
  line: number
  column: number
  content?: string
  contentGeneration?: number
  documentVersion?: number
  workspaceRoot?: string
}

export interface SemanticReplayDocument {
  path: string
  content: string
  contentGeneration: number
  documentVersion?: number
}

export interface SemanticDocumentSync {
  path: string
  content: string
  documentVersion: number
  workspaceRoot?: string
}

export interface SemanticResponseState {
  path: string
  contentGeneration: number
  documentVersion?: number
  dependencyGeneration: number
  documentCacheHit: boolean
  dependencyClosureCacheHit: boolean
  queryCacheHit: boolean
  loadedDocumentCount: number
  syntaxReady: boolean
  typeStatus?: "ready" | "partial" | "unsupported"
  typeEngine?: string
  typeEngineVersion?: string
  typeGeneration?: number
}

export interface SemanticLatencySummary {
  count: number
  p50Us: number
  p95Us: number
  maxUs: number
}

export interface SemanticRuntimeState {
  rssBytes: number
  heapUsedBytes: number
  heapTotalBytes: number
  externalBytes: number
  uptimeMs: number
  providerLatencies: Record<string, SemanticLatencySummary>
}

export const SEMANTIC_PROTOCOL_VERSION = 5

export type SemanticRequestMethod =
  | "health"
  | "restoreDocuments"
  | "didOpen"
  | "didChange"
  | "didClose"
  | "prepareDocument"
  | "gotoDefinition"
  | "findUsages"
  | "completion"
  | "resolveCompletion"
  | "signatureHelp"
  | "listCodeActions"
  | "resolveCodeAction"
  | "prepareRename"
  | "rename"

export interface SemanticRequest {
  id: string
  method: SemanticRequestMethod
  position?: SemanticDocumentPosition
  action?: SemanticCodeActionRequest
  completion?: SemanticCompletionItem
  newName?: string
  documents?: SemanticReplayDocument[]
  document?: SemanticDocumentSync
  documentPath?: string
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
  additionalTextEdits?: SemanticCompletionTextEdit[]
  data?: Record<string, unknown>
}

export interface SemanticCompletionTextEdit {
  path: string
  range: SemanticTextRange
  newText: string
  expectedVersion?: number
}

export interface SemanticSignatureParameter {
  label: string
  documentation?: string
}

export interface SemanticSignature {
  label: string
  documentation?: string
  parameters: SemanticSignatureParameter[]
}

export interface SemanticSignatureHelp {
  signatures: SemanticSignature[]
  activeSignature: number
  activeParameter: number
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

export interface SemanticUsageResult extends SemanticDefinitionTarget {
  preview: string
  kind: "semantic"
  confidence: "exact"
}

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
      expectedContentVersion?: string
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
  | { status: "ready"; path: string; documentVersion: number; contentGeneration: number }
  | { status: "ready"; path: string; contentGeneration: number; typeStatus: string; typeGeneration?: number }
  | { status: "closed"; path: string }
  | { restoredDocumentCount: number }
  | SemanticDefinitionTarget
  | SemanticUsageResult[]
  | { definition: SemanticDefinitionTarget | null; definitionCandidates?: SemanticDefinitionCandidate[] }
  | SemanticCompletionItem[]
  | SemanticCompletionItem
  | SemanticSignatureHelp
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
