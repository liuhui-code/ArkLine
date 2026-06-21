import { normalizePath, splitPathSegments } from "@/features/workspace/workspace-store";

export type DefinitionLocation = {
  path: string;
  line: number;
  column: number;
};

type LocalDefinitionRequest = {
  path: string;
  content: string;
  line: number;
  column: number;
};

type WorkspaceDefinitionRequest = LocalDefinitionRequest & {
  workspaceFiles: string[];
  readFile: (path: string) => Promise<string | null>;
};

type ImportBinding = {
  localName: string;
  importedName: string;
  source: string;
};

const identifierPattern = /[A-Za-z0-9_$]/;

function getOffsetAtLineColumn(content: string, line: number, column: number) {
  const lines = content.split("\n");
  const safeLine = Math.min(Math.max(line, 1), lines.length);
  let offset = 0;

  for (let index = 0; index < safeLine - 1; index += 1) {
    offset += (lines[index] ?? "").length + 1;
  }

  const currentLine = lines[safeLine - 1] ?? "";
  return Math.min(offset + Math.max(column - 1, 0), offset + currentLine.length);
}

function getIdentifierAtOffset(content: string, offset: number) {
  if (!content) {
    return null;
  }

  let start = Math.min(Math.max(offset, 0), content.length - 1);
  let end = start;

  if (!identifierPattern.test(content[start] ?? "")) {
    if (identifierPattern.test(content[start - 1] ?? "")) {
      start -= 1;
      end = start;
    } else {
      return null;
    }
  }

  while (start > 0 && identifierPattern.test(content[start - 1] ?? "")) {
    start -= 1;
  }

  while (end < content.length && identifierPattern.test(content[end] ?? "")) {
    end += 1;
  }

  return content.slice(start, end);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findDeclarationInContent(path: string, content: string, identifier: string): DefinitionLocation | null {
  const escapedIdentifier = escapeRegExp(identifier);
  const declarationMatchers = [
    new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:struct|class|interface|enum|type|function|const|let|var)\\s+(${escapedIdentifier})\\b`),
    new RegExp(`^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s*)*(?:public\\s+|private\\s+|protected\\s+|static\\s+|readonly\\s+|declare\\s+|abstract\\s+|override\\s+|async\\s+)*(?:get\\s+|set\\s+)?(${escapedIdentifier})\\s*\\([^)]*\\)\\s*(?::[^={]+)?\\s*(?:\\{|=>)`),
    new RegExp(`^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s*)*(?:public\\s+|private\\s+|protected\\s+|static\\s+|readonly\\s+|declare\\s+|abstract\\s+|override\\s+)*(?:const\\s+|let\\s+|var\\s+)?(${escapedIdentifier})\\s*(?::|=)`),
    new RegExp(`^\\s*export\\s+default\\s+(?:struct|class|interface|enum|type|function)\\s+(${escapedIdentifier})\\b`),
  ];

  const lines = content.split("\n");

  for (const matcher of declarationMatchers) {
    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index] ?? "";
      const match = lineText.match(matcher);

      if (!match || !match[1]) {
        continue;
      }

      return {
        path,
        line: index + 1,
        column: lineText.indexOf(match[1]) + 1,
      };
    }
  }

  return null;
}

function isWindowsStylePath(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\");
}

function getRootPrefix(path: string) {
  const normalized = normalizePath(path);
  if (/^[A-Za-z]:\\/.test(normalized)) {
    return normalized.slice(0, 2);
  }
  if (normalized.startsWith("/")) {
    return "/";
  }
  return "";
}

function getDirectorySegments(path: string) {
  const segments = splitPathSegments(path);
  if (segments.length > 0 && /^[A-Za-z]:$/.test(segments[0] ?? "")) {
    segments.shift();
  }
  segments.pop();
  return segments;
}

function joinResolvedPath(root: string, segments: string[], windowsStyle: boolean) {
  const separator = windowsStyle ? "\\" : "/";
  if (windowsStyle) {
    return `${root}\\${segments.join(separator)}`;
  }
  return `${root}${segments.join(separator)}`;
}

function resolveRelativeModulePath(fromFile: string, specifier: string) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const windowsStyle = isWindowsStylePath(fromFile);
  const root = getRootPrefix(fromFile);
  const segments = getDirectorySegments(fromFile);

  for (const segment of specifier.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return normalizePath(joinResolvedPath(root, segments, windowsStyle));
}

function resolveImportCandidates(fromFile: string, specifier: string, workspaceFiles: string[]) {
  const basePath = resolveRelativeModulePath(fromFile, specifier);
  if (!basePath) {
    return [];
  }

  const candidates = [
    basePath,
    `${basePath}.ets`,
    `${basePath}.ts`,
    `${basePath}.json5`,
    `${basePath}\\index.ets`,
    `${basePath}\\index.ts`,
    `${basePath}\\index.json5`,
    `${basePath}/index.ets`,
    `${basePath}/index.ts`,
    `${basePath}/index.json5`,
  ].map(normalizePath);

  const workspaceSet = new Set(workspaceFiles.map(normalizePath));
  return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index && workspaceSet.has(candidate));
}

function parseNamedImports(clause: string, source: string) {
  const openBrace = clause.indexOf("{");
  const closeBrace = clause.indexOf("}");
  if (openBrace === -1 || closeBrace === -1 || closeBrace <= openBrace) {
    return [];
  }

  const namedClause = clause.slice(openBrace + 1, closeBrace);
  return namedClause
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const aliasMatch = item.match(/^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/);
      if (aliasMatch) {
        return {
          localName: aliasMatch[2]!,
          importedName: aliasMatch[1]!,
          source,
        };
      }

      return {
        localName: item,
        importedName: item,
        source,
      };
    });
}

function parseDefaultImport(clause: string, source: string): ImportBinding[] {
  const cleaned = clause.split("{")[0]?.trim().replace(/,$/, "") ?? "";
  if (!cleaned || cleaned.startsWith("*")) {
    return [];
  }

  return [{
    localName: cleaned,
    importedName: "default",
    source,
  }];
}

function collectImportBindings(content: string) {
  const bindings: ImportBinding[] = [];
  const importRegex = /^\s*import\s+(.+?)\s+from\s+["'](.+?)["'];?\s*$/gm;

  for (const match of content.matchAll(importRegex)) {
    const clause = match[1]?.trim();
    const source = match[2]?.trim();
    if (!clause || !source) {
      continue;
    }

    bindings.push(...parseDefaultImport(clause, source));
    bindings.push(...parseNamedImports(clause, source));
  }

  return bindings;
}

async function findImportedDefinition(request: WorkspaceDefinitionRequest, identifier: string) {
  const importBinding = collectImportBindings(request.content).find((binding) => binding.localName === identifier);
  if (!importBinding) {
    return null;
  }

  const candidates = resolveImportCandidates(request.path, importBinding.source, request.workspaceFiles);
  for (const candidate of candidates) {
    const importedContent = await request.readFile(candidate);
    if (!importedContent) {
      continue;
    }

    const targetIdentifier = importBinding.importedName === "default" ? identifier : importBinding.importedName;
    const declaration = findDeclarationInContent(candidate, importedContent, targetIdentifier);
    if (declaration) {
      return declaration;
    }
  }

  return null;
}

export function findLocalDefinition(request: LocalDefinitionRequest): DefinitionLocation | null {
  const offset = getOffsetAtLineColumn(request.content, request.line, request.column);
  const identifier = getIdentifierAtOffset(request.content, offset);

  if (!identifier) {
    return null;
  }

  return findDeclarationInContent(request.path, request.content, identifier);
}

export async function findWorkspaceDefinition(request: WorkspaceDefinitionRequest): Promise<DefinitionLocation | null> {
  const offset = getOffsetAtLineColumn(request.content, request.line, request.column);
  const identifier = getIdentifierAtOffset(request.content, offset);

  if (!identifier) {
    return null;
  }

  const localDeclaration = findDeclarationInContent(request.path, request.content, identifier);
  if (localDeclaration) {
    return localDeclaration;
  }

  return findImportedDefinition(request, identifier);
}
