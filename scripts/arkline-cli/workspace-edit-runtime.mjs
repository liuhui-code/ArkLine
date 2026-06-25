import fs from "node:fs"
import path from "node:path"

const BLOCKED_PATH_SEGMENTS = new Set(["node_modules", "build", ".hvigor", ".git"])

export async function runWorkspaceEditCommand(command) {
  const plan = buildWorkspaceEditPlan(command)
  const conflicts = collectConflicts(command.workspace, plan)
  const dryRun = command.dryRun !== false

  if (dryRun) {
    if (conflicts.length > 0) {
      return {
        ok: false,
        error: "Workspace edit has conflicts",
        payload: {
          ...plan,
          conflicts,
        },
        dryRun,
      }
    }

    return { ok: true, payload: plan, dryRun }
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      error: "Workspace edit has conflicts",
      payload: {
        applied: false,
        conflicts,
        changedFiles: [],
      },
      dryRun,
    }
  }

  const changedFiles = applyWorkspaceEditPlan(command.workspace, plan)
  return {
    ok: true,
    payload: {
      applied: true,
      conflicts: [],
      changedFiles,
      summary: summarizePlan(plan),
    },
    dryRun,
  }
}

export function buildWorkspaceEditPlan(command) {
  switch (`${command.area} ${command.name}`) {
    case "generate page":
      return buildGeneratePlan({
        idPrefix: "generate.page",
        titlePrefix: "Generate page",
        undoPrefix: "Remove generated page",
        directory: "src/pages",
        name: command.symbolName,
        content: renderPage(command.symbolName),
      })
    case "generate component":
      return buildGeneratePlan({
        idPrefix: "generate.component",
        titlePrefix: "Generate component",
        undoPrefix: "Remove generated component",
        directory: "src/components",
        name: command.symbolName,
        content: renderComponent(command.symbolName),
      })
    case "rename-file workspace":
      return buildRenamePlan(command.file, command.to)
    default:
      throw new Error(`Unsupported workspace edit command: ${command.area} ${command.name}`)
  }
}

function buildGeneratePlan({ idPrefix, titlePrefix, undoPrefix, directory, name, content }) {
  const targetPath = toPosixPath(`${directory}/${name}.ets`)
  return withAffectedFiles({
    id: `${idPrefix}.${name}`,
    title: `${titlePrefix} ${name}`,
    operations: [
      {
        kind: "createFile",
        path: targetPath,
        content,
        overwrite: false,
      },
    ],
    conflicts: [],
    affectedFiles: [],
    undoLabel: `${undoPrefix} ${name}`,
    requiresPreview: true,
  })
}

function buildRenamePlan(oldPath, newPath) {
  return withAffectedFiles({
    id: `rename-file.${oldPath}`,
    title: `Rename ${oldPath} to ${newPath}`,
    operations: [
      {
        kind: "renameFile",
        oldPath,
        newPath,
        overwrite: false,
      },
    ],
    conflicts: [],
    affectedFiles: [],
    undoLabel: `Rename ${newPath} back to ${oldPath}`,
    requiresPreview: true,
  })
}

function applyWorkspaceEditPlan(workspace, plan) {
  const changedFiles = []

  for (const operation of plan.operations) {
    switch (operation.kind) {
      case "createFile": {
        const targetPath = resolveWorkspacePath(workspace, operation.path).absolutePath
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.writeFileSync(targetPath, operation.content, "utf8")
        changedFiles.push(operation.path)
        break
      }
      case "renameFile": {
        const oldPath = resolveWorkspacePath(workspace, operation.oldPath).absolutePath
        const newPath = resolveWorkspacePath(workspace, operation.newPath).absolutePath
        fs.mkdirSync(path.dirname(newPath), { recursive: true })
        if (operation.overwrite && fs.existsSync(newPath)) {
          fs.rmSync(newPath, { recursive: true, force: true })
        }
        fs.renameSync(oldPath, newPath)
        changedFiles.push(operation.newPath)
        break
      }
      default:
        throw new Error(`Unsupported workspace edit operation: ${operation.kind}`)
    }
  }

  return changedFiles
}

function collectConflicts(workspace, plan) {
  const conflicts = []

  for (const operation of plan.operations) {
    switch (operation.kind) {
      case "createFile":
        addPathConflicts(conflicts, workspace, operation.path)
        addCreateFileConflicts(conflicts, workspace, operation)
        break
      case "renameFile":
        addPathConflicts(conflicts, workspace, operation.oldPath)
        addPathConflicts(conflicts, workspace, operation.newPath)
        addRenameFileConflicts(conflicts, workspace, operation)
        break
      case "text":
      case "deleteFile":
        addPathConflicts(conflicts, workspace, operation.path)
        break
      default:
        conflicts.push({ path: "", message: `Unsupported workspace edit operation: ${operation.kind}.` })
        break
    }
  }

  return dedupeConflicts(conflicts)
}

function addCreateFileConflicts(conflicts, workspace, operation) {
  const resolved = resolveWorkspacePath(workspace, operation.path)
  if (!resolved.insideRoot || resolved.blocked) {
    return
  }

  addParentDirectoryConflicts(conflicts, workspace, operation.path, "Create file parent path must be a directory.")

  if (!operation.overwrite && fs.existsSync(resolved.absolutePath)) {
    conflicts.push({
      path: operation.path,
      message: "Create file target already exists.",
    })
  }
}

function addRenameFileConflicts(conflicts, workspace, operation) {
  const oldResolved = resolveWorkspacePath(workspace, operation.oldPath)
  const newResolved = resolveWorkspacePath(workspace, operation.newPath)
  if (!oldResolved.insideRoot || !newResolved.insideRoot || oldResolved.blocked || newResolved.blocked) {
    return
  }

  if (!fs.existsSync(oldResolved.absolutePath)) {
    conflicts.push({
      path: operation.oldPath,
      message: "Rename source file does not exist.",
    })
  } else if (fs.statSync(oldResolved.absolutePath).isDirectory()) {
    conflicts.push({
      path: operation.oldPath,
      message: "Rename source must be a file.",
    })
  }
  if (fs.existsSync(newResolved.absolutePath) && fs.statSync(newResolved.absolutePath).isDirectory()) {
    conflicts.push({
      path: operation.newPath,
      message: "Rename target must be a file path.",
    })
  }
  if (!operation.overwrite && fs.existsSync(newResolved.absolutePath)) {
    conflicts.push({
      path: operation.newPath,
      message: "Rename target already exists.",
    })
  }
}

function addParentDirectoryConflicts(conflicts, workspace, relativePath, message) {
  const parentPath = toPosixPath(path.dirname(relativePath))
  if (parentPath === ".") {
    return
  }

  const segments = parentPath.split("/").filter(Boolean)
  for (let index = 0; index < segments.length; index += 1) {
    const candidatePath = segments.slice(0, index + 1).join("/")
    const resolved = resolveWorkspacePath(workspace, candidatePath)
    if (!resolved.insideRoot || resolved.blocked || !fs.existsSync(resolved.absolutePath)) {
      continue
    }
    if (!fs.statSync(resolved.absolutePath).isDirectory()) {
      conflicts.push({
        path: candidatePath,
        message,
      })
      return
    }
  }
}

function addPathConflicts(conflicts, workspace, relativePath) {
  const resolved = resolveWorkspacePath(workspace, relativePath)
  if (!resolved.insideRoot) {
    conflicts.push({
      path: relativePath,
      message: "Path must stay inside the workspace root.",
    })
  }
  if (resolved.blocked) {
    conflicts.push({
      path: relativePath,
      message: `Path is inside a blocked directory: ${resolved.blockedSegment}.`,
    })
  }
}

function resolveWorkspacePath(workspace, relativePath) {
  const workspaceRoot = path.resolve(workspace)
  const workspaceRealPath = safeRealPath(workspaceRoot) ?? workspaceRoot
  const candidate = path.resolve(workspaceRoot, relativePath)
  const relative = path.relative(workspaceRoot, candidate)
  const lexicalInsideRoot = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  const existingAncestor = findExistingAncestor(candidate)
  const ancestorRealPath = existingAncestor ? safeRealPath(existingAncestor) : undefined
  const realInsideRoot = ancestorRealPath ? isPathInsideRoot(workspaceRealPath, ancestorRealPath) : true
  const segments = toPosixPath(relativePath).split("/").filter(Boolean)
  const blockedSegment = segments.find((segment) => BLOCKED_PATH_SEGMENTS.has(segment))

  return {
    absolutePath: candidate,
    insideRoot: lexicalInsideRoot && realInsideRoot,
    blocked: blockedSegment !== undefined,
    blockedSegment,
  }
}

function findExistingAncestor(candidate) {
  let current = candidate
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }

  return current
}

function safeRealPath(value) {
  try {
    return fs.realpathSync(value)
  } catch {
    return undefined
  }
}

function isPathInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function withAffectedFiles(plan) {
  return {
    ...plan,
    affectedFiles: collectAffectedFiles(plan.operations),
  }
}

function collectAffectedFiles(operations) {
  const affectedFiles = []
  const seen = new Set()
  for (const operation of operations) {
    const files = operation.kind === "renameFile" ? [operation.oldPath, operation.newPath] : [operation.path]
    for (const file of files) {
      if (!seen.has(file)) {
        seen.add(file)
        affectedFiles.push(file)
      }
    }
  }
  return affectedFiles
}

function summarizePlan(plan) {
  return plan.operations.map((operation) => {
    switch (operation.kind) {
      case "createFile":
        return `Create ${operation.path}`
      case "renameFile":
        return `Rename ${operation.oldPath} to ${operation.newPath}`
      default:
        return `${operation.kind} ${operation.path ?? ""}`.trim()
    }
  })
}

function dedupeConflicts(conflicts) {
  const seen = new Set()
  const deduped = []
  for (const conflict of conflicts) {
    const key = `${conflict.path}\0${conflict.message}`
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(conflict)
    }
  }
  return deduped
}

function renderPage(name) {
  return [
    "@Entry",
    "@Component",
    `struct ${name} {`,
    "  build() {",
    "  }",
    "}",
    "",
  ].join("\n")
}

function renderComponent(name) {
  return [
    "@Component",
    `struct ${name} {`,
    "  build() {",
    "  }",
    "}",
    "",
  ].join("\n")
}

function toPosixPath(value) {
  return value.split(path.sep).join("/")
}
