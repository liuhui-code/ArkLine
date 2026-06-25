import fs from "node:fs"
import path from "node:path"

export interface WorkspaceDocument {
  path: string
  content: string
}

export interface WorkspaceSnapshot {
  rootPath: string
  documents: WorkspaceDocument[]
}

const SOURCE_ROOT_MARKER = `${path.sep}src${path.sep}main${path.sep}ets${path.sep}`
const SUPPORTED_EXTENSIONS = new Set([".ets", ".ts"])

export function loadWorkspace(fromFilePath: string, currentDocumentContent?: string): WorkspaceSnapshot {
  const rootPath = resolveWorkspaceRoot(fromFilePath)
  const documents = overlayCurrentDocument(
    collectWorkspaceDocuments(rootPath),
    path.resolve(fromFilePath),
    currentDocumentContent,
  )

  return {
    rootPath,
    documents,
  }
}

function overlayCurrentDocument(
  documents: WorkspaceDocument[],
  currentPath: string,
  currentDocumentContent?: string,
): WorkspaceDocument[] {
  if (currentDocumentContent === undefined) {
    return documents
  }

  let replaced = false
  const nextDocuments = documents.map((document) => {
    if (path.resolve(document.path) !== currentPath) {
      return document
    }

    replaced = true
    return {
      ...document,
      content: currentDocumentContent,
    }
  })

  if (replaced) {
    return nextDocuments
  }

  return [
    ...nextDocuments,
    {
      path: currentPath,
      content: currentDocumentContent,
    },
  ]
}

function resolveWorkspaceRoot(filePath: string): string {
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

function collectWorkspaceDocuments(rootPath: string): WorkspaceDocument[] {
  const documents: WorkspaceDocument[] = []
  walkDirectory(rootPath, documents)
  return documents
}

function walkDirectory(currentPath: string, documents: WorkspaceDocument[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
      continue
    }

    const nextPath = path.join(currentPath, entry.name)
    if (entry.isDirectory()) {
      walkDirectory(nextPath, documents)
      continue
    }

    if (!entry.isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(entry.name))) {
      continue
    }

    try {
      documents.push({
        path: nextPath,
        content: fs.readFileSync(nextPath, "utf8"),
      })
    } catch {
      continue
    }
  }
}
