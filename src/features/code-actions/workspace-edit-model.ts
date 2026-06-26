export type TextRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type EditConflict = {
  path: string;
  message: string;
};

export type WorkspaceEditOperation =
  | {
      kind: "text";
      path: string;
      range: TextRange;
      newText: string;
      expectedVersion?: number;
    }
  | {
      kind: "createFile";
      path: string;
      content: string;
      overwrite: boolean;
    }
  | {
      kind: "createDirectory";
      path: string;
    }
  | {
      kind: "renameFile";
      oldPath: string;
      newPath: string;
      overwrite: boolean;
    }
  | {
      kind: "renameDirectory";
      oldPath: string;
      newPath: string;
      overwrite: boolean;
    }
  | {
      kind: "deleteFile";
      path: string;
      recursive: boolean;
    }
  | {
      kind: "deleteDirectory";
      path: string;
      recursive: boolean;
    };

export type WorkspaceEditPlan = {
  id: string;
  title: string;
  operations: WorkspaceEditOperation[];
  conflicts: EditConflict[];
  affectedFiles: string[];
  undoLabel: string;
  requiresPreview: boolean;
};

function addPath(paths: string[], seen: Set<string>, path: string) {
  if (seen.has(path)) {
    return;
  }

  seen.add(path);
  paths.push(path);
}

function collectOperationFiles(operation: WorkspaceEditOperation) {
  switch (operation.kind) {
    case "text":
    case "createFile":
    case "createDirectory":
    case "deleteFile":
    case "deleteDirectory":
      return [operation.path];
    case "renameFile":
    case "renameDirectory":
      return [operation.oldPath, operation.newPath];
  }
}

function hasPositiveRangePosition(range: TextRange) {
  return range.startLine > 0
    && range.startColumn > 0
    && range.endLine > 0
    && range.endColumn > 0;
}

function isInvertedRange(range: TextRange) {
  if (range.endLine < range.startLine) {
    return true;
  }

  return range.endLine === range.startLine && range.endColumn < range.startColumn;
}

export function collectAffectedFiles(plan: WorkspaceEditPlan) {
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const operation of plan.operations) {
    for (const path of collectOperationFiles(operation)) {
      addPath(paths, seen, path);
    }
  }

  return paths;
}

export function validateWorkspaceEditPlan(plan: WorkspaceEditPlan) {
  const errors: string[] = [];

  plan.operations.forEach((operation, index) => {
    if (operation.kind !== "text") {
      return;
    }

    const operationNumber = index + 1;

    if (!hasPositiveRangePosition(operation.range)) {
      errors.push(`Operation ${operationNumber} has a non-positive text range position.`);
      return;
    }

    if (isInvertedRange(operation.range)) {
      errors.push(`Operation ${operationNumber} has an inverted text range.`);
    }
  });

  return errors;
}

export function summarizeWorkspaceEditOperation(operation: WorkspaceEditOperation) {
  switch (operation.kind) {
    case "text":
      return `Edit ${operation.path} at ${operation.range.startLine}:${operation.range.startColumn}-${operation.range.endLine}:${operation.range.endColumn}`;
    case "createFile":
      return operation.overwrite ? `Create or overwrite ${operation.path}` : `Create ${operation.path}`;
    case "createDirectory":
      return `Create directory ${operation.path}`;
    case "renameFile":
      return operation.overwrite
        ? `Rename ${operation.oldPath} to ${operation.newPath} and overwrite if needed`
        : `Rename ${operation.oldPath} to ${operation.newPath}`;
    case "renameDirectory":
      return operation.overwrite
        ? `Rename directory ${operation.oldPath} to ${operation.newPath} and overwrite if needed`
        : `Rename directory ${operation.oldPath} to ${operation.newPath}`;
    case "deleteFile":
      return operation.recursive ? `Delete ${operation.path} recursively` : `Delete ${operation.path}`;
    case "deleteDirectory":
      return operation.recursive ? `Delete directory ${operation.path} recursively` : `Delete directory ${operation.path}`;
  }
}
