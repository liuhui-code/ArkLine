export interface SemanticDocumentPosition {
  path: string
  line: number
  column: number
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
}

export interface SemanticDefinitionTarget {
  path: string
  line: number
  column: number
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
