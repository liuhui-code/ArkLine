const WARMUP_SAMPLE_COUNT = 4;

export function summarizeProcessAttribution(samples) {
  const roles = new Map();
  for (const sample of samples) {
    for (const process of sample.processes ?? []) {
      const role = processRole(process);
      if (!role) continue;
      const entries = roles.get(role) ?? [];
      entries.push({
        capturedAt: sample.capturedAt,
        rssBytes: process.WorkingSet64 ?? 0,
        privateBytes: process.PrivateMemorySize64 ?? 0,
      });
      roles.set(role, entries);
    }
  }
  return Object.fromEntries([...roles].map(([role, entries]) => [role, summarize(entries)]));
}

function processRole(process) {
  const value = `${process.ProcessName ?? ""} ${process.CommandLine ?? ""}`.toLowerCase();
  if (value.includes("--type=renderer")) return "renderer";
  if (value.includes("arkline-semantic") || value.includes("semantic-worker")) return "semanticWorker";
  if (String(process.ProcessName ?? "").toLowerCase() === "arkline") return "application";
  return null;
}

function summarize(entries) {
  const steady = entries.slice(WARMUP_SAMPLE_COUNT);
  return {
    sampleCount: entries.length,
    first: entries.at(0) ?? null,
    last: entries.at(-1) ?? null,
    rssGrowthBytes: growth(steady.map((entry) => entry.rssBytes)),
    privateGrowthBytes: growth(steady.map((entry) => entry.privateBytes)),
  };
}

function growth(values) {
  if (values.length < 2) return 0;
  return Math.max(0, values.at(-1) - values[0]);
}
