import type { EnvironmentReport } from "@/features/workspace/workspace-api";

type EnvironmentPanelProps = {
  report: EnvironmentReport | null;
  visible: boolean;
};

export function EnvironmentPanel({ report, visible }: EnvironmentPanelProps) {
  if (!visible || !report) {
    return null;
  }

  return (
    <section className="environment-panel" aria-label="Environment Status">
      {report.tools.map((tool) => (
        <div key={tool.name} className={`environment-item environment-item--${tool.available ? "ok" : "warn"}`}>
          <strong>{tool.name}</strong>
          <span>{tool.detail}</span>
        </div>
      ))}
    </section>
  );
}
