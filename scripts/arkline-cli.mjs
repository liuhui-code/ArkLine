#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { parseArklineCliArgs } from "./arkline-cli/cli-parser.mjs"
import { SemanticWorkerClient } from "./arkline-cli/semantic-client.mjs"
import { runWorkspaceEditCommand } from "./arkline-cli/workspace-edit-runtime.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")
const WORKER_ENTRY = path.join(PROJECT_ROOT, "semantic-worker", "dist", "main.js")

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    printJson({ ok: false, error: error instanceof Error ? error.message : String(error) })
    process.exitCode = 1
  })
}

export async function main(args, io = {}) {
  const stdout = io.stdout ?? process.stdout
  const parsed = parseArklineCliArgs(args)
  if (!parsed.ok) {
    printJson(parsed, stdout)
    process.exitCode = 1
    return
  }

  if (isWorkspaceEditCommand(parsed.command)) {
    const result = await runWorkspaceEditCommand(parsed.command)
    if (parsed.command.output === "pretty") {
      printPrettyWorkspaceEditResult(parsed.command, result, stdout)
    } else {
      printJson(result, stdout)
    }
    if (!result.ok || hasConflicts(result.payload)) {
      process.exitCode = 1
    }
    return
  }

  const worker = createClient()
  try {
    const response = await runCommand(worker, parsed.command)
    if (!response.ok) {
      printJson({ ok: false, error: response.error ?? "Semantic worker request failed" }, stdout)
      process.exitCode = 1
      return
    }

    printJson({ ok: true, payload: response.payload, dryRun: parsed.command.dryRun }, stdout)
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
    case "actions resolve":
      return {
        id: "actions-resolve-1",
        method: "resolveCodeAction",
        action: { id: command.id },
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

function printJson(value, stdout = process.stdout) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printPrettyWorkspaceEditResult(command, result, stdout = process.stdout) {
  stdout.write(`${formatPrettyWorkspaceEditResult(command, result)}\n`)
}

function formatPrettyWorkspaceEditResult(command, result) {
  const payload = result.payload
  const conflicts = Array.isArray(payload?.conflicts) ? payload.conflicts : []
  const lines = [payload?.title ?? buildWorkspaceEditTitle(command)]

  if (conflicts.length > 0) {
    lines.push(`Mode: ${result.dryRun ? "dry-run" : "apply"}`)
    lines.push("Conflicts:")
    for (const conflict of conflicts) {
      lines.push(`- ${conflict.path}: ${conflict.message}`)
    }
    return lines.join("\n")
  }

  if (payload?.applied) {
    lines.push("Applied: yes")
    lines.push("Changed files:")
    for (const changedFile of payload.changedFiles ?? []) {
      lines.push(`- ${changedFile}`)
    }
    return lines.join("\n")
  }

  lines.push("Mode: dry-run")
  lines.push("Affected files:")
  for (const affectedFile of payload?.affectedFiles ?? []) {
    lines.push(`- ${affectedFile}`)
  }
  lines.push("Operations:")
  for (const operation of payload?.operations ?? []) {
    lines.push(`- ${formatWorkspaceEditOperation(operation)}`)
  }

  return lines.join("\n")
}

function buildWorkspaceEditTitle(command) {
  switch (`${command.area} ${command.name}`) {
    case "generate page":
      return `Generate page ${command.symbolName}`
    case "generate component":
      return `Generate component ${command.symbolName}`
    case "rename-file workspace":
      return `Rename ${command.file} to ${command.to}`
    default:
      return "Workspace edit"
  }
}

function formatWorkspaceEditOperation(operation) {
  switch (operation.kind) {
    case "createFile":
      return operation.overwrite ? `Create or overwrite ${operation.path}` : `Create ${operation.path}`
    case "renameFile":
      return operation.overwrite
        ? `Rename ${operation.oldPath} to ${operation.newPath} and overwrite if needed`
        : `Rename ${operation.oldPath} to ${operation.newPath}`
    default:
      return `${operation.kind} ${operation.path ?? ""}`.trim()
  }
}

function isWorkspaceEditCommand(command) {
  return command.area === "generate" || command.area === "rename-file"
}

function hasConflicts(payload) {
  return Array.isArray(payload?.conflicts) && payload.conflicts.length > 0
}
