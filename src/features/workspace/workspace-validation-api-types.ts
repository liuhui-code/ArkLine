export type ValidationProblem = {
  source: "lint" | "format" | "language" | "build";
  severity: "error" | "warning";
  path: string;
  line: number;
  column: number;
  message: string;
  fix?: ValidationFix;
};

export type ValidationAvailability = "ready" | "partial" | "unavailable";

export type ValidationQueryResult = {
  availability: ValidationAvailability;
  items: ValidationProblem[];
  message?: string;
};

export type ValidationFix = {
  title: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  replacement: string;
};
