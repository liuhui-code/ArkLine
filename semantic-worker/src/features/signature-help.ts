import { discoverHarmonySdk } from "../sdk/discovery.js"
import { findArkuiApiDefinition } from "../sdk/arkui-api-index.js"
import type {
  SemanticDocumentPosition,
  SemanticSignatureHelp,
  SemanticSignatureParameter,
} from "../protocol.js"
import type { SemanticWorkspaceView } from "../workspace/document-store.js"
import type { SemanticTypeQueryContext } from "../types/type-engine.js"

export function resolveSignatureHelp(
  position: SemanticDocumentPosition | undefined,
  workspace: SemanticWorkspaceView | undefined,
  typeEngine?: SemanticTypeQueryContext,
): SemanticSignatureHelp | null {
  if (!position || !workspace) return null
  const document = workspace.documents.find((item) => item.path === position.path)
  if (!document) return null
  const context = readCallContext(document.content, position)
  if (!context) return null
  const sdkRoot = discoverHarmonySdk().path ?? undefined
  const entry = context.isChain
    ? findArkuiApiDefinition(sdkRoot, context.name, context.component)
    : null
  if (!entry) {
    const typed = typeEngine?.signatureHelp(position)
    if (typed?.signatures.length) return typed
    return null
  }

  const parameters = parseParameters(entry.signature)
  return {
    signatures: [{
      label: entry.signature,
      documentation: entry.documentation ?? entry.detail,
      parameters,
    }],
    activeSignature: 0,
    activeParameter: Math.min(context.argumentIndex, Math.max(parameters.length - 1, 0)),
  }
}

export function readCallContext(content: string, position: SemanticDocumentPosition) {
  const line = content.split(/\r?\n/)[position.line - 1] ?? ""
  const before = line.slice(0, Math.max(position.column - 1, 0))
  const open = findActiveOpenParenthesis(before)
  if (open < 0) return null
  const match = before.slice(0, open).match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/)
  if (!match) return null
  const argumentsText = before.slice(open + 1)
  const componentPattern = new RegExp(`([A-Z][A-Za-z0-9_$]*)\\s*\\([^)]*\\)\\s*\\.\\s*${escapeRegExp(match[1])}\\s*\\($`)
  const component = before.slice(0, open + 1).match(componentPattern)?.[1]
  const chainPattern = new RegExp(`\\.\\s*${escapeRegExp(match[1])}\\s*\\($`)
  return {
    name: match[1],
    component: component ?? null,
    isChain: chainPattern.test(before.slice(0, open + 1)),
    argumentIndex: countTopLevelCommas(argumentsText),
  }
}

function findActiveOpenParenthesis(value: string) {
  let depth = 0
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] === ")") depth += 1
    else if (value[index] === "(" && depth > 0) depth -= 1
    else if (value[index] === "(" && depth === 0) return index
  }
  return -1
}

function parseParameters(signature: string): SemanticSignatureParameter[] {
  const open = signature.indexOf("(")
  const close = signature.lastIndexOf(")")
  if (open < 0 || close <= open) return []
  return splitArguments(signature.slice(open + 1, close)).map((label) => ({ label }))
}

function splitArguments(value: string): string[] {
  if (!value.trim()) return []
  const items: string[] = []
  let start = 0
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    if ("([{<".includes(value[index])) depth += 1
    if (")]}>".includes(value[index])) depth -= 1
    if (value[index] === "," && depth === 0) {
      items.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  items.push(value.slice(start).trim())
  return items.filter(Boolean)
}

function countTopLevelCommas(value: string) {
  let count = 0
  let depth = 0
  for (const character of value) {
    if ("([{<".includes(character)) depth += 1
    if (")]}>".includes(character)) depth -= 1
    if (character === "," && depth === 0) count += 1
  }
  return count
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
