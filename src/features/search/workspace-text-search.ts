import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

export type SearchQuery =
  | { kind: "text"; query: string }
  | { kind: "regex"; query: string; expression?: RegExp }
  | { kind: "invalid"; query: string; message: string };

export type WorkspaceTextSearchMatch = {
  path: string;
  relativePath: string;
  fileName: string;
  line: number;
  column: number;
  summary: string;
  preview: string;
  previewStart: number;
  previewEnd: number;
  contextBefore: { line: number; text: string }[];
  contextAfter: { line: number; text: string }[];
};

export type WorkspaceTextSearchOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
};

export type WorkspaceTextSearchResult = {
  query: SearchQuery;
  matches: WorkspaceTextSearchMatch[];
};

type SearchWorkspaceTextOptions = {
  query: string;
  rootPath: string;
  paths: string[];
  readFile: (path: string) => Promise<string | null>;
  options?: WorkspaceTextSearchOptions;
  contextLines?: number;
  limit?: number;
};

const REGEX_QUERY_PATTERN = /^\/(.+)\/([a-z]*)$/i;

export function parseSearchQuery(input: string): SearchQuery {
  const query = input.trim();
  if (!query) {
    return { kind: "text", query: "" };
  }

  const regexMatch = query.match(REGEX_QUERY_PATTERN);
  if (!regexMatch) {
    return { kind: "text", query };
  }

  const [, source, flags] = regexMatch;
  try {
    return {
      kind: "regex",
      query,
      expression: new RegExp(source, flags.includes("g") ? flags : `${flags}g`),
    };
  } catch (error) {
    return {
      kind: "invalid",
      query,
      message: error instanceof Error ? error.message : "Invalid regular expression",
    };
  }
}

export function getRelativeWorkspacePath(rootPath: string, path: string) {
  const normalizedRoot = normalizePath(rootPath).replace(/[\\/]+$/u, "");
  const normalizedPath = normalizePath(path);
  const rootPrefix = normalizedRoot.includes("\\") ? `${normalizedRoot}\\` : `${normalizedRoot}/`;

  if (normalizedPath.startsWith(rootPrefix)) {
    return normalizedPath.slice(rootPrefix.length).replace(/\\/g, "/");
  }

  return normalizedPath.replace(/\\/g, "/");
}

export async function searchWorkspaceText({
  query,
  rootPath,
  paths,
  readFile,
  options = { caseSensitive: false, wholeWord: false },
  contextLines = 2,
  limit = 50,
}: SearchWorkspaceTextOptions): Promise<WorkspaceTextSearchResult> {
  const parsedQuery = parseSearchQuery(query);
  if (parsedQuery.kind === "invalid" || !parsedQuery.query) {
    return { query: parsedQuery, matches: [] };
  }

  const matches: WorkspaceTextSearchMatch[] = [];

  for (const path of paths) {
    if (matches.length >= limit) {
      break;
    }

    const content = await readFile(path);
    if (!content) {
      continue;
    }

    const lines = content.split(/\r?\n/u);
    const relativePath = getRelativeWorkspacePath(rootPath, path);
    const fileName = getPathBasename(path);

    for (let index = 0; index < lines.length; index += 1) {
      if (matches.length >= limit) {
        break;
      }

      const lineText = lines[index] ?? "";
      const matchRange = findLineMatch(lineText, parsedQuery, options);
      if (!matchRange) {
        continue;
      }

      matches.push({
        path,
        relativePath,
        fileName,
        line: index + 1,
        column: matchRange.start + 1,
        summary: buildSummary(lineText, matchRange.start, matchRange.end),
        preview: lineText,
        previewStart: matchRange.start,
        previewEnd: matchRange.end,
        contextBefore: sliceContext(lines, index - contextLines, index),
        contextAfter: sliceContext(lines, index + 1, index + 1 + contextLines),
      });
    }
  }

  return { query: parsedQuery, matches };
}

function findLineMatch(lineText: string, query: SearchQuery, options: WorkspaceTextSearchOptions) {
  if (query.kind === "text") {
    const searchLine = options.caseSensitive ? lineText : lineText.toLowerCase();
    const searchQuery = options.caseSensitive ? query.query : query.query.toLowerCase();
    let start = searchLine.indexOf(searchQuery);

    while (start >= 0) {
      const end = start + searchQuery.length;
      if (!options.wholeWord || isWholeWordBoundary(lineText, start, end)) {
        return { start, end };
      }
      start = searchLine.indexOf(searchQuery, start + 1);
    }
    return null;
  }

  if (query.kind !== "regex") {
    return null;
  }

  if (!query.expression) {
    return null;
  }

  const expression = new RegExp(query.expression.source, query.expression.flags);
  const match = expression.exec(lineText);
  if (!match || match.index < 0) {
    return null;
  }

  return {
    start: match.index,
    end: match.index + match[0].length,
  };
}

function isWholeWordBoundary(lineText: string, start: number, end: number) {
  const left = start > 0 ? lineText[start - 1] : "";
  const right = end < lineText.length ? lineText[end] : "";
  return !isWordCharacter(left) && !isWordCharacter(right);
}

function isWordCharacter(value: string) {
  return /\w/u.test(value);
}

function buildSummary(lineText: string, start: number, end: number) {
  const summaryRadius = 18;
  const summaryStart = Math.max(0, start - summaryRadius);
  const summaryEnd = Math.min(lineText.length, end + summaryRadius);
  const prefix = summaryStart > 0 ? "..." : "";
  const suffix = summaryEnd < lineText.length ? "..." : "";
  return `${prefix}${lineText.slice(summaryStart, summaryEnd).trim()}${suffix}`;
}

function sliceContext(lines: string[], start: number, end: number) {
  const context: { line: number; text: string }[] = [];

  for (let index = Math.max(0, start); index < Math.min(lines.length, end); index += 1) {
    context.push({
      line: index + 1,
      text: lines[index] ?? "",
    });
  }

  return context;
}
