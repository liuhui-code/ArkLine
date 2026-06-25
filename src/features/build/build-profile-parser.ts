export function parseBuildProfileProducts(content: string): string[] {
  const productBlockMatch = content.match(/products\s*:\s*\[([\s\S]*?)\]/m);
  const searchArea = productBlockMatch?.[1] ?? content;
  const names: string[] = [];
  const namePattern = /name\s*:\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = namePattern.exec(searchArea)) !== null) {
    const name = match[1].trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names.length > 0 ? names : ["default"];
}
