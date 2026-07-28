function findNamedArray(content: string, name: string) {
  const match = new RegExp(`\\b${name}\\s*:\\s*\\[`, "m").exec(content);
  if (!match) {
    return null;
  }

  const start = match.index + match[0].lastIndexOf("[") + 1;
  let depth = 1;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if ((character === "/" && next === "/") || (character === "/" && next === "*")) {
      lineComment = character === "/" && next === "/";
      blockComment = !lineComment;
      index += 1;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(start, index);
      }
    }
  }

  return content.slice(start);
}

export function parseBuildProfileProducts(content: string): string[] {
  const searchArea = findNamedArray(content, "products");
  if (!searchArea) {
    return ["default"];
  }

  const names: string[] = [];
  const namePattern = /\bname\s*:\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = namePattern.exec(searchArea)) !== null) {
    const name = match[1].trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names.length > 0 ? names : ["default"];
}

export function parseBuildProfileModules(content: string): string[] {
  const searchArea = findNamedArray(content, "modules");
  if (!searchArea) {
    return [];
  }

  const names: string[] = [];
  const namePattern = /\bname\s*:\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = namePattern.exec(searchArea)) !== null) {
    const name = match[1].trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}
