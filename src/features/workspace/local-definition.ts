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

export function findLocalDefinition(request: LocalDefinitionRequest): DefinitionLocation | null {
  const offset = getOffsetAtLineColumn(request.content, request.line, request.column);
  const identifier = getIdentifierAtOffset(request.content, offset);

  if (!identifier) {
    return null;
  }

  const declarationMatchers = [
    new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:struct|class|interface|enum|type|function|const|let|var)\\s+(${escapeRegExp(identifier)})\\b`),
    new RegExp(`^\\s*(?:public\\s+|private\\s+|protected\\s+|static\\s+|async\\s+|override\\s+)*(?:get\\s+|set\\s+)?(${escapeRegExp(identifier)})\\s*\\(`),
  ];

  const lines = request.content.split("\n");

  for (const matcher of declarationMatchers) {
    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index] ?? "";
      const match = lineText.match(matcher);

      if (!match || !match[1]) {
        continue;
      }

      return {
        path: request.path,
        line: index + 1,
        column: lineText.indexOf(match[1]) + 1,
      };
    }
  }

  return null;
}
