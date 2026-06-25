#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { parseArklineCliArgs } from "./arkline-cli/cli-parser.mjs"
import { SemanticWorkerClient } from "./arkline-cli/semantic-client.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")
const WORKER_ENTRY = path.join(PROJECT_ROOT, "semantic-worker", "dist", "main.js")

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    printJson({ ok: false, error: error instanceof Error ? error.message : String(error) })
    process.exitCode = 1
  })
}

export async function main(args) {
  const parsed = parseArklineCliArgs(args)
  if (!parsed.ok) {
    printJson(parsed)
    process.exitCode = 1
    return
  }

  const worker = createClient()
  try {
    const response = await runCommand(worker, parsed.command)
    if (!response.ok) {
      printJson({ ok: false, error: response.error ?? "Semantic worker request failed" })
      process.exitCode = 1
      return
    }

    printJson({ ok: true, payload: response.payload, dryRun: parsed.command.dryRun })
  } finally {
    await worker.close()
  }
}

export function buildSemanticRequest(command) {
  switch (`${command.area} ${command.name}`) {
    case "language inspect":
      return { id: "language-inspect-1", method: "health" }
    case "language completion":
      return {
        id: "language-completion-1",
        method: "completion",
        position: buildPosition(command),
      }
    case "actions list":
      return {
        id: "actions-list-1",
        method: "listCodeActions",
        position: buildPosition(command),
      }
    default:
      throw new Error(`Unsupported command: ${command.area} ${command.name}`)
  }
}

function createClient() {
  if (!fs.existsSync(WORKER_ENTRY)) {
    throw new Error(`Semantic worker entry is missing: ${WORKER_ENTRY}. Run 'pnpm build:semantic-worker' first.`)
  }
  return new SemanticWorkerClient(WORKER_ENTRY)
}

async function runCommand(worker, command) {
  return worker.request(buildSemanticRequest(command))
}

function buildPosition(command) {
  return {
    path: path.resolve(command.workspace, command.file),
    line: command.line,
    column: command.column,
  }
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}
