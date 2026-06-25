export interface SemanticDocumentPosition {
  path: string
  line: number
  column: number
  content?: string
}

export interface SemanticRequest {
  id: string
  method: "health" | "gotoDefinition" | "completion"
  position?: SemanticDocumentPosition
}

export interface SemanticCompletionItem {
  label: string
  detail: string
  kind: string
  insertText?: string
  filterText?: string
  sortText?: string
  source?: "workspace" | "arkts" | "arkui" | "sdk" | "fallback"
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

export type SemanticResponsePayload =
  | { status: "ready" }
  | SemanticDefinitionTarget
  | { definition: SemanticDefinitionTarget | null; definitionCandidates?: SemanticDefinitionCandidate[] }
  | SemanticCompletionItem[]
  | null

export interface SemanticResponse {
  id: string
  ok: boolean
  payload: SemanticResponsePayload
  error?: string
}
