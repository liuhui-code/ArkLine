export function formatArkTsDocument(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const normalized = lines.map((line) => line.replace(/\t/g, "  ").replace(/[ \t]+$/g, ""));
  return `${normalized.join("\n").replace(/\n+$/g, "")}\n`;
}
