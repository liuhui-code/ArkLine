export interface SemanticGoldenMarkerRef {
  file: string
  marker: string
}

export interface SemanticGoldenDefinitionCase {
  id: string
  capability: "definition"
  coverage: string[]
  query: SemanticGoldenMarkerRef
  expected: SemanticGoldenMarkerRef
}

export interface SemanticGoldenCompletionExpectation {
  topK: number
  required: Array<{ label: string; kind: string }>
  forbiddenKinds: string[]
  forbiddenLabels: string[]
}

export interface SemanticGoldenCompletionCase {
  id: string
  capability: "completion"
  coverage: string[]
  query: SemanticGoldenMarkerRef
  expected: SemanticGoldenCompletionExpectation
}

export type SemanticGoldenCase = SemanticGoldenDefinitionCase | SemanticGoldenCompletionCase

export interface SemanticGoldenCorpus {
  schemaVersion: 1
  id: string
  projectDirectory: string
  sdkDirectory?: string
  cases: SemanticGoldenCase[]
}

export interface SemanticGoldenFailure {
  id: string
  reason: string
}

export interface SemanticGoldenReport {
  schemaVersion: 1
  corpusId: string
  caseCount: number
  passedCases: number
  failedCases: SemanticGoldenFailure[]
  coverage: string[]
  definition: {
    exact: number
    total: number
  }
  completion: {
    cases: number
    requiredTopK: number
    totalRequired: number
    forbiddenViolations: number
  }
}

export interface MaterializedMarker {
  file: string
  line: number
  column: number
}
