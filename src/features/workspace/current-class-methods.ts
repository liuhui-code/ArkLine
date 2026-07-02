export type CurrentClassMethod = {
  kind: "method" | "member";
  name: string;
  signature: string;
  line: number;
  column: number;
};

type ClassBlock = {
  startLine: number;
  endLine: number;
};

const classStartPattern = /^\s*(?:export\s+)?(?:abstract\s+)?(?:class|struct)\s+[A-Za-z_$][\w$]*[^{]*\{/;
const methodPattern = /^(\s*)(?:(?:public|private|protected|static|override|async)\s+)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::[^{]+)?(?:\{|$)/;
const memberPattern = /^(\s*)(?:(?:public|private|protected|static|readonly|override)\s+)*(?:@[A-Za-z_$][\w$]*(?:\([^)]*\))?\s*)*([A-Za-z_$][\w$]*)\??\s*(?::\s*([^=;{]+))?(?:\s*=.*)?;?\s*$/;
const nonMethodNames = new Set(["if", "for", "while", "switch", "catch", "function"]);

export function collectCurrentClassMethods(content: string, caretLine: number): CurrentClassMethod[] {
  const lines = content.split("\n");
  const block = findEnclosingClassBlock(lines, caretLine);
  if (!block) {
    return [];
  }

  const methods: CurrentClassMethod[] = [];
  let depth = 0;
  for (let index = block.startLine - 1; index < block.endLine; index += 1) {
    const line = lines[index] ?? "";
    if (index > block.startLine - 1 && depth === 1) {
      const match = methodPattern.exec(line);
      if (match) {
        const [, indent, name, args] = match;
        if (!nonMethodNames.has(name) && !line.includes("=>") && !line.trimStart().startsWith(".")) {
          methods.push({
            kind: "method",
            name,
            signature: `${name}(${args.trim()})`,
            line: index + 1,
            column: indent.length + line.slice(indent.length).indexOf(name) + 1,
          });
        }
      }

      const memberMatch = memberPattern.exec(line);
      if (memberMatch && !line.includes("(") && !line.trimStart().startsWith("@")) {
        const [, indent, name, typeName] = memberMatch;
        if (!nonMethodNames.has(name)) {
          methods.push({
            kind: "member",
            name,
            signature: typeName?.trim() ? `${name}: ${typeName.trim()}` : name,
            line: index + 1,
            column: indent.length + line.slice(indent.length).indexOf(name) + 1,
          });
        }
      }
    }
    depth += braceDelta(line);
  }

  return methods;
}

function findEnclosingClassBlock(lines: string[], caretLine: number): ClassBlock | null {
  const caret = Math.max(1, Math.min(caretLine, lines.length));
  let best: ClassBlock | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!classStartPattern.test(line)) {
      continue;
    }

    let depth = 0;
    for (let blockIndex = index; blockIndex < lines.length; blockIndex += 1) {
      depth += braceDelta(lines[blockIndex] ?? "");
      if (depth === 0) {
        const block = { startLine: index + 1, endLine: blockIndex + 1 };
        if (block.startLine <= caret && caret <= block.endLine) {
          best = block;
        }
        break;
      }
    }
  }

  return best;
}

function braceDelta(line: string) {
  let delta = 0;
  for (const char of line) {
    if (char === "{") delta += 1;
    if (char === "}") delta -= 1;
  }
  return delta;
}
