export function IndexDiagnosticsMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="index-diagnostics__metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
