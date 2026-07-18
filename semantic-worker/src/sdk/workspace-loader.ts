import fs from "node:fs"
import path from "node:path"

export interface WorkspaceDocument {
  path: string
  content: string
}

const SOURCE_ROOT_MARKER = `${path.sep}src${path.sep}main${path.sep}ets${path.sep}`

export function resolveWorkspaceRoot(filePath: string): string {
  const normalized = path.resolve(filePath)
  const markerIndex = normalized.lastIndexOf(SOURCE_ROOT_MARKER)
  if (markerIndex >= 0) {
    return normalized.slice(0, markerIndex)
  }

  let current = path.dirname(normalized)
  while (true) {
    const candidate = path.join(current, "src", "main", "ets")
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return path.dirname(normalized)
    }
    current = parent
  }
}
