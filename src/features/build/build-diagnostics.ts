import type { ProblemItem } from "@/features/problems/problems-store";

export type BuildDiagnosticMatcher = {
  id: string;
  match(output: string): ProblemItem[];
};

const fileLocationPattern = /(?:File:\s*)?((?:[A-Za-z]:)?[\\/].+?\.(?:ets|ts|js|json5|json|hml|css|less|scss)):(\d+):(\d+)(?:\s*(.*))?/i;

function severityFromLine(line: string): ProblemItem["severity"] {
  return /\b(warn|warning)\b/i.test(line) ? "warning" : "error";
}

function cleanMessage(raw: string) {
  return raw.replace(/^[-:\s]+/, "").trim();
}

export const hvigorFileDiagnosticMatcher: BuildDiagnosticMatcher = {
  id: "hvigor-file-location",
  match(output) {
    const lines = output.split(/\r?\n/);
    const problems: ProblemItem[] = [];

    lines.forEach((line, index) => {
      const match = line.match(fileLocationPattern);
      if (!match) {
        return;
      }

      const inlineMessage = cleanMessage(match[4] ?? "");
      const nextMessage = cleanMessage(lines[index + 1] ?? "");
      problems.push({
        source: "build",
        severity: severityFromLine(line),
        path: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        message: inlineMessage || nextMessage || "Build diagnostic",
      });
    });

    return problems;
  },
};

export const defaultBuildDiagnosticMatchers: BuildDiagnosticMatcher[] = [
  hvigorFileDiagnosticMatcher,
];

export function parseBuildDiagnostics(output: string, matchers = defaultBuildDiagnosticMatchers): ProblemItem[] {
  return matchers.flatMap((matcher) => matcher.match(output));
}
