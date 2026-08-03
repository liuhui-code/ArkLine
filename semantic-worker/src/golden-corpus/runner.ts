import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import type { SemanticCompletionItem, SemanticDefinitionTarget } from "../protocol.js"
import { SemanticWorkerSession } from "../session.js"
import type {
  MaterializedMarker,
  SemanticGoldenCompletionCase,
  SemanticGoldenCorpus,
  SemanticGoldenDefinitionCase,
  SemanticGoldenFailure,
  SemanticGoldenReport,
} from "./model.js"

const MARKER_PATTERN = /\/\*@([A-Za-z0-9._-]+)\*\//gu

interface MaterializedCorpus {
  projectRoot: string
  sdkRoot: string | null
  markers: Map<string, MaterializedMarker>
}

export function runSemanticGoldenCorpus(corpusPath: string): SemanticGoldenReport {
  const corpus = readCorpus(corpusPath)
  const corpusRoot = path.dirname(corpusPath)
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-semantic-golden-"))
  const projectRoot = path.join(tempRoot, "project")
  const sdkRoot = corpus.sdkDirectory ? path.join(tempRoot, "sdk") : null
  const previousSdkPath = process.env.ARKLINE_HARMONY_SDK_PATH
  try {
    const markers = materializeProject(
      path.resolve(corpusRoot, corpus.projectDirectory),
      projectRoot,
    )
    if (corpus.sdkDirectory && sdkRoot) {
      materializeProject(path.resolve(corpusRoot, corpus.sdkDirectory), sdkRoot, markers, "@sdk/")
      process.env.ARKLINE_HARMONY_SDK_PATH = sdkRoot
    }
    const runtime = { projectRoot, sdkRoot, markers }
    const failures: SemanticGoldenFailure[] = []
    let definitionExact = 0
    let definitionTotal = 0
    let completionCases = 0
    let completionRequiredTopK = 0
    let completionTotalRequired = 0
    let completionForbiddenViolations = 0
    const session = new SemanticWorkerSession()

    for (const testCase of corpus.cases) {
      if (testCase.capability === "definition") {
        definitionTotal += 1
        const failure = runDefinitionCase(session, runtime, testCase)
        if (failure) failures.push({ id: testCase.id, reason: failure })
        else definitionExact += 1
      } else if (testCase.capability === "completion") {
        completionCases += 1
        completionTotalRequired += testCase.expected.required.length
        const result = runCompletionCase(session, runtime, testCase)
        completionRequiredTopK += result.requiredTopK
        completionForbiddenViolations += result.forbiddenViolations
        if (result.failure) failures.push({ id: testCase.id, reason: result.failure })
      }
    }

    return {
      schemaVersion: 1,
      corpusId: corpus.id,
      caseCount: corpus.cases.length,
      passedCases: corpus.cases.length - failures.length,
      failedCases: failures,
      coverage: [...new Set(corpus.cases.flatMap((testCase) => testCase.coverage))].sort(),
      definition: { exact: definitionExact, total: definitionTotal },
      completion: {
        cases: completionCases,
        requiredTopK: completionRequiredTopK,
        totalRequired: completionTotalRequired,
        forbiddenViolations: completionForbiddenViolations,
      },
    }
  } finally {
    if (previousSdkPath === undefined) delete process.env.ARKLINE_HARMONY_SDK_PATH
    else process.env.ARKLINE_HARMONY_SDK_PATH = previousSdkPath
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function runCompletionCase(
  session: SemanticWorkerSession,
  runtime: MaterializedCorpus,
  testCase: SemanticGoldenCompletionCase,
): { requiredTopK: number; forbiddenViolations: number; failure: string | null } {
  const query = requireMarker(runtime.markers, testCase.query)
  const response = session.handle({
    id: testCase.id,
    method: "completion",
    position: {
      path: materializedPath(runtime, query.file),
      line: query.line,
      column: query.column,
      workspaceRoot: runtime.projectRoot,
    },
  })
  if (!response.ok) {
    return { requiredTopK: 0, forbiddenViolations: 0, failure: response.error ?? "completion query failed" }
  }
  if (!Array.isArray(response.payload)) {
    return { requiredTopK: 0, forbiddenViolations: 0, failure: "completion query returned no items" }
  }
  const items = response.payload as SemanticCompletionItem[]
  const topItems = items.slice(0, testCase.expected.topK)
  const missing = testCase.expected.required.filter((required) => !topItems.some((item) => (
    item.label === required.label && item.kind === required.kind
  )))
  const forbidden = items.filter((item) => (
    testCase.expected.forbiddenKinds.includes(item.kind)
    || testCase.expected.forbiddenLabels.includes(item.label)
  ))
  const reasons = [
    missing.length > 0
      ? `missing Top-${testCase.expected.topK}: ${missing.map((item) => `${item.label}:${item.kind}`).join(", ")}`
      : null,
    forbidden.length > 0
      ? `forbidden candidates: ${forbidden.map((item) => `${item.label}:${item.kind}`).join(", ")}`
      : null,
  ].filter((reason): reason is string => Boolean(reason))
  return {
    requiredTopK: testCase.expected.required.length - missing.length,
    forbiddenViolations: forbidden.length,
    failure: reasons.length > 0 ? reasons.join("; ") : null,
  }
}

function runDefinitionCase(
  session: SemanticWorkerSession,
  runtime: MaterializedCorpus,
  testCase: SemanticGoldenDefinitionCase,
): string | null {
  const query = requireMarker(runtime.markers, testCase.query)
  const expected = requireMarker(runtime.markers, testCase.expected)
  const response = session.handle({
    id: testCase.id,
    method: "gotoDefinition",
    position: {
      path: materializedPath(runtime, query.file),
      line: query.line,
      column: query.column,
      workspaceRoot: runtime.projectRoot,
    },
  })
  if (!response.ok) return response.error ?? "definition query failed"
  const actual = definitionTarget(response.payload)
  if (!actual) return "definition query returned no target"
  const expectedPath = materializedPath(runtime, expected.file)
  if (path.resolve(actual.path) !== path.resolve(expectedPath)) {
    return `expected path ${expected.file}, received ${path.relative(runtime.projectRoot, actual.path)}`
  }
  if (actual.line !== expected.line || actual.column !== expected.column) {
    return `expected ${expected.line}:${expected.column}, received ${actual.line}:${actual.column}`
  }
  return null
}

function readCorpus(corpusPath: string): SemanticGoldenCorpus {
  const parsed = JSON.parse(fs.readFileSync(corpusPath, "utf8")) as unknown
  if (!isRecord(parsed)) throw new Error("Semantic golden corpus must be an object")
  if (parsed.schemaVersion !== 1) throw new Error("Semantic golden corpus schemaVersion must be 1")
  if (typeof parsed.id !== "string"
    || typeof parsed.projectDirectory !== "string"
    || (parsed.sdkDirectory !== undefined && typeof parsed.sdkDirectory !== "string")
    || !Array.isArray(parsed.cases)) {
    throw new Error("Semantic golden corpus is missing id, projectDirectory, or cases")
  }
  for (const testCase of parsed.cases) {
    if (!isRecord(testCase)) throw new Error("Semantic golden case must be an object")
    if (testCase.capability !== "definition" && testCase.capability !== "completion") {
      throw new Error(`Unsupported semantic golden capability: ${String(testCase.capability)}`)
    }
    if (!Array.isArray(testCase.coverage)
      || testCase.coverage.length === 0
      || testCase.coverage.some((entry) => typeof entry !== "string" || !entry)) {
      throw new Error("Semantic golden case coverage must contain non-empty strings")
    }
  }
  return parsed as unknown as SemanticGoldenCorpus
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function materializeProject(
  sourceRoot: string,
  targetRoot: string,
  markers = new Map<string, MaterializedMarker>(),
  filePrefix = "",
): Map<string, MaterializedMarker> {
  for (const sourcePath of listFiles(sourceRoot)) {
    const relativePath = path.relative(sourceRoot, sourcePath)
    const corpusPath = `${filePrefix}${relativePath.split(path.sep).join("/")}`
    const targetPath = path.join(targetRoot, relativePath)
    const source = fs.readFileSync(sourcePath, "utf8")
    const clean = stripMarkers(source, corpusPath, markers)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, clean)
  }
  return markers
}

function materializedPath(runtime: MaterializedCorpus, corpusFile: string): string {
  if (!corpusFile.startsWith("@sdk/")) return path.join(runtime.projectRoot, corpusFile)
  if (!runtime.sdkRoot) throw new Error(`SDK file requested without sdkDirectory: ${corpusFile}`)
  return path.join(runtime.sdkRoot, corpusFile.slice("@sdk/".length))
}

function listFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  })
}

function stripMarkers(
  source: string,
  relativePath: string,
  markers: Map<string, MaterializedMarker>,
): string {
  let clean = ""
  let sourceOffset = 0
  for (const match of source.matchAll(MARKER_PATTERN)) {
    const markerOffset = match.index ?? 0
    clean += source.slice(sourceOffset, markerOffset)
    const markerId = match[1]
    if (!markerId) throw new Error(`Invalid marker in ${relativePath}`)
    if (markers.has(markerId)) throw new Error(`Duplicate semantic golden marker: ${markerId}`)
    markers.set(markerId, { file: relativePath, ...offsetToPosition(clean, clean.length) })
    sourceOffset = markerOffset + match[0].length
  }
  return clean + source.slice(sourceOffset)
}

function offsetToPosition(content: string, offset: number): { line: number; column: number } {
  const before = content.slice(0, offset)
  const line = before.split("\n").length
  const lineStart = before.lastIndexOf("\n")
  return { line, column: offset - lineStart }
}

function requireMarker(
  markers: Map<string, MaterializedMarker>,
  reference: { file: string; marker: string },
): MaterializedMarker {
  const marker = markers.get(reference.marker)
  if (!marker) throw new Error(`Missing semantic golden marker: ${reference.marker}`)
  if (marker.file !== reference.file) {
    throw new Error(`Marker ${reference.marker} belongs to ${marker.file}, not ${reference.file}`)
  }
  return marker
}

function definitionTarget(payload: unknown): SemanticDefinitionTarget | null {
  if (!payload || typeof payload !== "object") return null
  if ("path" in payload && "line" in payload && "column" in payload) {
    return payload as SemanticDefinitionTarget
  }
  if ("definition" in payload) {
    return (payload as { definition?: SemanticDefinitionTarget | null }).definition ?? null
  }
  return null
}
