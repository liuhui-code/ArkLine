import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { performance } from "node:perf_hooks"

const WORKER_ENTRY = path.resolve("semantic-worker/dist/main.js")

async function main() {
  const args = parseArgs(process.argv.slice(2))
  ensureWorkerEntry()

  const fixtureRoot = args.fixture ? createFixtureWorkspace() : null
  const requests = fixtureRoot
    ? buildFixtureRequests(fixtureRoot)
    : buildWorkspaceRequests(args)

  const timings = {
    healthMs: 0,
    definitionMs: 0,
    completionMs: 0,
  }

  const worker = new SemanticWorkerClient(WORKER_ENTRY)
  try {
    const healthStartedAt = performance.now()
    const health = await worker.request({ id: "health-1", method: "health" })
    timings.healthMs = roundMs(performance.now() - healthStartedAt)

    if (health.payload?.status !== "ready") {
      throw new Error(`Worker health did not report ready: ${JSON.stringify(health.payload)}`)
    }

    const definitionStartedAt = performance.now()
    const definition = await worker.request(requests.definition)
    timings.definitionMs = roundMs(performance.now() - definitionStartedAt)

    const completionStartedAt = performance.now()
    const completion = await worker.request(requests.completion)
    timings.completionMs = roundMs(performance.now() - completionStartedAt)

    const definitionTarget = normalizeDefinitionPayload(definition.payload)
    assertDefinition(definitionTarget, requests.expectedDefinition)
    assertCompletion(completion.payload, requests.expectedCompletionLabel)

    const summary = {
      workerEntry: WORKER_ENTRY,
      mode: fixtureRoot ? "fixture" : "workspace",
      definitionTarget,
      completionLabels: Array.isArray(completion.payload)
        ? completion.payload.map((item) => item.label)
        : [],
      timings,
    }

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  } finally {
    await worker.close()
    if (fixtureRoot) {
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    }
  }
}

function parseArgs(argv) {
  const options = {
    fixture: false,
    file: "",
    definitionLine: 0,
    definitionColumn: 0,
    completionLine: 0,
    completionColumn: 0,
    expectDefinitionPath: "",
    expectDefinitionLine: 0,
    expectDefinitionColumn: 0,
    expectCompletionLabel: "",
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    switch (value) {
      case "--fixture":
        options.fixture = true
        break
      case "--file":
        options.file = requireNext(argv, ++index, value)
        break
      case "--definition-line":
        options.definitionLine = parseNumber(requireNext(argv, ++index, value), value)
        break
      case "--definition-column":
        options.definitionColumn = parseNumber(requireNext(argv, ++index, value), value)
        break
      case "--completion-line":
        options.completionLine = parseNumber(requireNext(argv, ++index, value), value)
        break
      case "--completion-column":
        options.completionColumn = parseNumber(requireNext(argv, ++index, value), value)
        break
      case "--expect-definition-path":
        options.expectDefinitionPath = requireNext(argv, ++index, value)
        break
      case "--expect-definition-line":
        options.expectDefinitionLine = parseNumber(requireNext(argv, ++index, value), value)
        break
      case "--expect-definition-column":
        options.expectDefinitionColumn = parseNumber(requireNext(argv, ++index, value), value)
        break
      case "--expect-completion-label":
        options.expectCompletionLabel = requireNext(argv, ++index, value)
        break
      case "--help":
        printUsage()
        process.exit(0)
      default:
        throw new Error(`Unknown argument: ${value}`)
    }
  }

  if (!options.fixture) {
    if (
      !options.file ||
      options.definitionLine < 1 ||
      options.definitionColumn < 1 ||
      options.completionLine < 1 ||
      options.completionColumn < 1 ||
      !options.expectDefinitionPath ||
      options.expectDefinitionLine < 1 ||
      options.expectDefinitionColumn < 1 ||
      !options.expectCompletionLabel
    ) {
      throw new Error("Workspace mode requires --file, definition/completion positions, and expected definition/completion values")
    }
  }

  return options
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node scripts/smoke-semantic.mjs --fixture",
      "  node scripts/smoke-semantic.mjs --file <path> --definition-line <n> --definition-column <n> --completion-line <n> --completion-column <n> --expect-definition-path <path> --expect-definition-line <n> --expect-definition-column <n> --expect-completion-label <label>",
    ].join("\n") + "\n",
  )
}

function requireNext(argv, index, flag) {
  const next = argv[index]
  if (!next) {
    throw new Error(`${flag} requires a value`)
  }
  return next
}

function parseNumber(value, flag) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a positive integer`)
  }
  return parsed
}

function ensureWorkerEntry() {
  if (!fs.existsSync(WORKER_ENTRY)) {
    throw new Error(`Semantic worker entry is missing: ${WORKER_ENTRY}. Run 'pnpm build:semantic-worker' first.`)
  }
}

function createFixtureWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-semantic-smoke-"))
  const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
  const componentsDir = path.join(root, "entry", "src", "main", "ets", "components")
  fs.mkdirSync(pagesDir, { recursive: true })
  fs.mkdirSync(componentsDir, { recursive: true })

  fs.writeFileSync(
    path.join(componentsDir, "Shared.ets"),
    "export function sharedSubmit() {\n  return 1;\n}\n",
  )
  fs.writeFileSync(
    path.join(pagesDir, "Index.ets"),
    "import { sharedSubmit } from '../components/Shared';\n\nfunction buildPage() {\n  sharedSubmit();\n}\n",
  )

  return root
}

function buildFixtureRequests(root) {
  const indexPath = path.join(root, "entry", "src", "main", "ets", "pages", "Index.ets")
  const sharedPath = path.join(root, "entry", "src", "main", "ets", "components", "Shared.ets")

  return {
    definition: {
      id: "definition-1",
      method: "gotoDefinition",
      position: { path: indexPath, line: 4, column: 5 },
    },
    completion: {
      id: "completion-1",
      method: "completion",
      position: { path: indexPath, line: 1, column: 1 },
    },
    expectedDefinition: {
      path: sharedPath,
      line: 1,
      column: 17,
    },
    expectedCompletionLabel: "sharedSubmit()",
  }
}

function buildWorkspaceRequests(args) {
  return {
    definition: {
      id: "definition-1",
      method: "gotoDefinition",
      position: {
        path: path.resolve(args.file),
        line: args.definitionLine,
        column: args.definitionColumn,
      },
    },
    completion: {
      id: "completion-1",
      method: "completion",
      position: {
        path: path.resolve(args.file),
        line: args.completionLine,
        column: args.completionColumn,
      },
    },
    expectedDefinition: {
      path: path.resolve(args.expectDefinitionPath),
      line: args.expectDefinitionLine,
      column: args.expectDefinitionColumn,
    },
    expectedCompletionLabel: args.expectCompletionLabel,
  }
}

function assertDefinition(payload, expected) {
  if (!payload) {
    throw new Error("Definition request returned no target")
  }

  if (
    path.resolve(payload.path) !== path.resolve(expected.path) ||
    payload.line !== expected.line ||
    payload.column !== expected.column
  ) {
    throw new Error(
      `Definition mismatch. Expected ${expected.path}:${expected.line}:${expected.column}, received ${payload.path}:${payload.line}:${payload.column}`,
    )
  }
}

function normalizeDefinitionPayload(payload) {
  if (!payload) {
    return null
  }

  if (payload.definition) {
    return payload.definition
  }

  return payload
}

function assertCompletion(payload, expectedLabel) {
  if (!Array.isArray(payload)) {
    throw new Error(`Completion payload was not an array: ${JSON.stringify(payload)}`)
  }

  if (!payload.some((item) => item?.label === expectedLabel)) {
    throw new Error(`Expected completion item '${expectedLabel}' was not returned`)
  }
}

function roundMs(value) {
  return Number.parseFloat(value.toFixed(2))
}

class SemanticWorkerClient {
  constructor(entryPath) {
    this.child = spawn(process.execPath, [entryPath], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.stderr = ""
    this.pending = new Map()
    this.buffer = ""

    this.child.stdout.setEncoding("utf8")
    this.child.stderr.setEncoding("utf8")

    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk
      this.flushResponses()
    })

    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk
    })

    this.child.on("exit", (code, signal) => {
      if (this.pending.size === 0) {
        return
      }

      const detail = `Semantic worker exited unexpectedly (code=${String(code)}, signal=${String(signal)})${this.stderr ? `: ${this.stderr.trim()}` : ""}`
      for (const { reject } of this.pending.values()) {
        reject(new Error(detail))
      }
      this.pending.clear()
    })
  }

  request(message) {
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify(message)}\n`, "utf8", (error) => {
        if (error) {
          this.pending.delete(message.id)
          reject(error)
        }
      })
    })
  }

  flushResponses() {
    let newlineIndex = this.buffer.indexOf("\n")
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line) {
        const response = JSON.parse(line)
        const pending = this.pending.get(response.id)
        if (pending) {
          this.pending.delete(response.id)
          if (response.ok) {
            pending.resolve(response)
          } else {
            pending.reject(new Error(response.error ?? "Semantic worker request failed"))
          }
        }
      }
      newlineIndex = this.buffer.indexOf("\n")
    }
  }

  async close() {
    if (this.child.exitCode !== null) {
      return
    }

    this.child.kill()
    await new Promise((resolve) => {
      this.child.once("exit", () => resolve())
      setTimeout(() => resolve(), 1000)
    })
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
