import type { ProblemItem } from "@/features/problems/problems-store";

type ProblemsPanelProps = {
  problems: ProblemItem[];
};

export function ProblemsPanel({ problems }: ProblemsPanelProps) {
  return (
    <section aria-label="Problems Panel" className="bottom-tool-window__panel">
      {problems.length > 0 ? (
        <div className="problems-list" role="list" aria-label="Problems List">
          {problems.map((problem) => (
            <div
              key={`${problem.source}:${problem.path}:${problem.line}:${problem.column}:${problem.message}`}
              className={`problem-item problem-item--${problem.severity}`}
              role="listitem"
            >
              <strong>{problem.source}</strong>
              <span>{problem.message}</span>
              <span className="problem-meta">
                {`${problem.path}:${problem.line}:${problem.column}`}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p>Lint and format findings will appear here after save.</p>
      )}
    </section>
  );
}
