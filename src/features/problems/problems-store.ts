export type ProblemSource = "lint" | "format" | "language";
export type ProblemSeverity = "error" | "warning";

export type ProblemItem = {
  source: ProblemSource;
  severity: ProblemSeverity;
  path: string;
  line: number;
  column: number;
  message: string;
};

export type ProblemsState = {
  items: ProblemItem[];
};

const supportedSources: ProblemSource[] = ["lint", "format", "language"];

function severityWeight(severity: ProblemSeverity) {
  return severity === "error" ? 0 : 1;
}

function compareProblems(left: ProblemItem, right: ProblemItem) {
  const severityDelta = severityWeight(left.severity) - severityWeight(right.severity);

  if (severityDelta !== 0) {
    return severityDelta;
  }

  if (left.path !== right.path) {
    return left.path.localeCompare(right.path);
  }

  if (left.line !== right.line) {
    return left.line - right.line;
  }

  if (left.column !== right.column) {
    return left.column - right.column;
  }

  return left.message.localeCompare(right.message);
}

function problemKey(item: ProblemItem) {
  return [
    item.source,
    item.severity,
    item.path,
    item.line,
    item.column,
    item.message,
  ].join(":");
}

export function createProblemsStore() {
  const state: ProblemsState = {
    items: [],
  };

  return {
    state,
    replace(items: ProblemItem[]) {
      const deduped = new Map<string, ProblemItem>();

      items.forEach((item) => {
        if (!supportedSources.includes(item.source)) {
          return;
        }

        deduped.set(problemKey(item), item);
      });

      state.items = Array.from(deduped.values()).sort(compareProblems);
    },
  };
}
