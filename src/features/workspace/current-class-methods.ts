import { scanLines } from "@/features/workspace/text-line-scanner";

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
  methods: CurrentClassMethod[];
};

type ActiveClassBlock = {
  startLine: number;
  depth: number;
  methods: CurrentClassMethod[];
};

const classStartPattern = /^\s*(?:export\s+)?(?:abstract\s+)?(?:class|struct)\s+[A-Za-z_$][\w$]*[^{]*\{/;
const methodPattern = /^(\s*)(?:(?:public|private|protected|static|override|async)\s+)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::[^{]+)?(?:\{|$)/;
const memberPattern = /^(\s*)(?:(?:public|private|protected|static|readonly|override)\s+)*(?:@[A-Za-z_$][\w$]*(?:\([^)]*\))?\s*)*([A-Za-z_$][\w$]*)\??\s*(?::\s*([^=;{]+))?(?:\s*=.*)?;?\s*$/;
const nonMethodNames = new Set(["if", "for", "while", "switch", "catch", "function"]);

export function collectCurrentClassMethods(content: string, caretLine: number): CurrentClassMethod[] {
  const block = findEnclosingClassBlock(content, Math.max(1, caretLine));
  if (!block) {
    return [];
  }
  return block.methods;
}

function findEnclosingClassBlock(content: string, caret: number): ClassBlock | null {
  let best: ClassBlock | null = null;
  const activeBlocks: ActiveClassBlock[] = [];

  scanLines(content, ({ text: lineText, line }) => {
    for (const block of activeBlocks) {
      if (line > block.startLine && block.depth === 1) {
        const method = parseCurrentClassMethod(lineText, line);
        if (method) block.methods.push(method);
      }
    }

    if (classStartPattern.test(lineText)) {
      activeBlocks.push({ startLine: line, depth: 0, methods: [] });
    }

    const delta = braceDelta(lineText);
    for (let index = activeBlocks.length - 1; index >= 0; index -= 1) {
      const block = activeBlocks[index]!;
      block.depth += delta;
      if (block.depth !== 0) continue;
      if (block.startLine <= caret && caret <= line) {
        best = { startLine: block.startLine, endLine: line, methods: block.methods };
      }
      activeBlocks.splice(index, 1);
    }
  });

  return best;
}

function parseCurrentClassMethod(line: string, lineNumber: number): CurrentClassMethod | null {
  const methodMatch = methodPattern.exec(line);
  if (methodMatch) {
    const [, indent, name, args] = methodMatch;
    if (!nonMethodNames.has(name) && !line.includes("=>") && !line.trimStart().startsWith(".")) {
      return {
        kind: "method",
        name,
        signature: `${name}(${args.trim()})`,
        line: lineNumber,
        column: indent.length + line.slice(indent.length).indexOf(name) + 1,
      };
    }
  }

  const memberMatch = memberPattern.exec(line);
  if (!memberMatch || line.includes("(") || line.trimStart().startsWith("@")) {
    return null;
  }
  const [, indent, name, typeName] = memberMatch;
  if (nonMethodNames.has(name)) {
    return null;
  }
  return {
    kind: "member",
    name,
    signature: typeName?.trim() ? `${name}: ${typeName.trim()}` : name,
    line: lineNumber,
    column: indent.length + line.slice(indent.length).indexOf(name) + 1,
  };
}

function braceDelta(line: string) {
  let delta = 0;
  for (const char of line) {
    if (char === "{") delta += 1;
    if (char === "}") delta -= 1;
  }
  return delta;
}
