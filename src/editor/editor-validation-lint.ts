import {
  forEachDiagnostic,
  linter,
  lintGutter,
  lintKeymap,
  type Diagnostic,
  type LintSource,
} from "@codemirror/lint";
import { Prec, type Text } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import type { ValidationFix, ValidationProblem } from "@/features/workspace/workspace-api";

export type EditorValidationRequest = (
  path: string,
  content: string,
) => Promise<ValidationProblem[]>;

export type EditorValidationResultHandler = (
  path: string,
  problems: ValidationProblem[],
) => void;

export type EditorDiagnosticFixRequest = {
  path: string;
  content: string;
  fix: ValidationFix;
};

export type EditorDiagnosticFixRequestHandler = (request: EditorDiagnosticFixRequest) => void;

export function createEditorValidationExtensions(
  getActivePath: () => string,
  validate: EditorValidationRequest,
  onResult?: EditorValidationResultHandler,
  onFixRequest?: EditorDiagnosticFixRequestHandler,
) {
  let requestGeneration = 0;
  const source: LintSource = async (view) => {
    const generation = requestGeneration + 1;
    requestGeneration = generation;
    const path = getActivePath();
    const document = view.state.doc;
    const problems = await validate(path, document.toString());

    if (
      generation !== requestGeneration
      || getActivePath() !== path
      || view.state.doc !== document
    ) {
      return [];
    }

    const currentProblems = problems.filter((problem) => problem.path === path);
    onResult?.(path, currentProblems);
    return currentProblems.map((problem) => toDiagnostic(document, problem, path, onFixRequest));
  };

  return [
    lintGutter(),
    linter(source, { delay: 500 }),
    Prec.highest(keymap.of([
      { key: "Alt-Enter", run: applyDiagnosticFixAtSelection },
      ...lintKeymap,
    ])),
  ];
}

function applyDiagnosticFixAtSelection(view: EditorView) {
  const head = view.state.selection.main.head;
  const selectionLine = view.state.doc.lineAt(head).number;
  let candidate: { diagnostic: Diagnostic; from: number; to: number } | undefined;

  forEachDiagnostic(view.state, (diagnostic, from, to) => {
    if (
      !candidate
      && diagnostic.actions?.length
      && (head >= from && head <= to || view.state.doc.lineAt(from).number === selectionLine)
    ) {
      candidate = { diagnostic, from, to };
    }
  });

  const action = candidate?.diagnostic.actions?.[0];
  if (!candidate || !action) {
    return false;
  }

  action.apply(view, candidate.from, candidate.to);
  return true;
}

function toDiagnostic(
  document: Text,
  problem: ValidationProblem,
  path: string,
  onFixRequest?: EditorDiagnosticFixRequestHandler,
): Diagnostic {
  const range = problem.fix
    ? textRange(document, problem.fix.startLine, problem.fix.startColumn, problem.fix.endLine, problem.fix.endColumn)
    : textRange(document, problem.line, problem.column, problem.line, problem.column + 1);

  return {
    from: range.from,
    to: range.to,
    severity: problem.severity,
    source: problem.source,
    message: problem.message,
    actions: problem.fix ? [{
      name: problem.fix.title,
      apply(view, from, to) {
        if (problem.fix && onFixRequest) {
          onFixRequest({ path, content: document.toString(), fix: problem.fix });
          return;
        }
        view.dispatch({ changes: { from, to, insert: problem.fix?.replacement ?? "" } });
      },
    }] : undefined,
  };
}

function textRange(
  document: Text,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
) {
  const start = lineColumnPosition(document, startLine, startColumn);
  const end = lineColumnPosition(document, endLine, endColumn);
  return { from: Math.min(start, end), to: Math.max(start, end) };
}

function lineColumnPosition(document: Text, lineNumber: number, column: number) {
  const line = document.line(Math.min(Math.max(lineNumber, 1), document.lines));
  return Math.min(line.from + Math.max(column - 1, 0), line.to);
}
