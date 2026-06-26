import type { WorkspaceEditPlan } from "@/features/code-actions/workspace-edit-model";

export type WorkspacePathKind = "file" | "directory";

function pathSeparator(path: string) {
  return path.includes("\\") ? "\\" : "/";
}

function trimTrailingSeparators(path: string) {
  return path.replace(/[\\/]+$/g, "");
}

function joinPath(parentPath: string, name: string) {
  const parent = trimTrailingSeparators(parentPath);
  return `${parent}${pathSeparator(parent)}${name}`;
}

function parentPath(path: string) {
  const normalized = trimTrailingSeparators(path);
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index > 0 ? normalized.slice(0, index) : "";
}

function assertValidName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Name is required");
  }

  if (/[\\/]/.test(trimmed)) {
    throw new Error("Name cannot contain path separators");
  }

  return trimmed;
}

function basePlan(id: string, title: string, operations: WorkspaceEditPlan["operations"]): WorkspaceEditPlan {
  return {
    id,
    title,
    operations,
    conflicts: [],
    affectedFiles: [],
    undoLabel: `Undo ${title}`,
    requiresPreview: true,
  };
}

export function createNewFilePlan(parentDirectoryPath: string, name: string): WorkspaceEditPlan {
  const fileName = assertValidName(name);
  const path = joinPath(parentDirectoryPath, fileName);

  return basePlan(`workspace.createFile.${path}`, `Create File ${fileName}`, [
    {
      kind: "createFile",
      path,
      content: "",
      overwrite: false,
    },
  ]);
}

export function createNewDirectoryPlan(parentDirectoryPath: string, name: string): WorkspaceEditPlan {
  const directoryName = assertValidName(name);
  const path = joinPath(parentDirectoryPath, directoryName);

  return basePlan(`workspace.createDirectory.${path}`, `Create Directory ${directoryName}`, [
    {
      kind: "createDirectory",
      path,
    },
  ]);
}

export function createRenamePathPlan(path: string, kind: WorkspacePathKind, newName: string): WorkspaceEditPlan {
  const name = assertValidName(newName);
  const newPath = joinPath(parentPath(path), name);
  const operation = kind === "directory"
    ? { kind: "renameDirectory" as const, oldPath: path, newPath, overwrite: false }
    : { kind: "renameFile" as const, oldPath: path, newPath, overwrite: false };

  return basePlan(`workspace.rename.${path}`, `Rename ${name}`, [operation]);
}

export function createDeletePathPlan(path: string, kind: WorkspacePathKind): WorkspaceEditPlan {
  const operation = kind === "directory"
    ? { kind: "deleteDirectory" as const, path, recursive: true }
    : { kind: "deleteFile" as const, path, recursive: false };

  return basePlan(`workspace.delete.${path}`, `Delete ${path}`, [operation]);
}
