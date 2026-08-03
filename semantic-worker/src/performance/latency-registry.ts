import type { SemanticLatencySummary } from "../protocol.js"

const MAX_SAMPLES_PER_PROVIDER = 128

export class SemanticLatencyRegistry {
  private readonly samples = new Map<string, number[]>()

  record(provider: string, durationMs: number): void {
    const samples = this.samples.get(provider) ?? []
    samples.push(Math.max(0, Math.round(durationMs * 1000)))
    if (samples.length > MAX_SAMPLES_PER_PROVIDER) {
      samples.splice(0, samples.length - MAX_SAMPLES_PER_PROVIDER)
    }
    this.samples.set(provider, samples)
  }

  snapshot(): Record<string, SemanticLatencySummary> {
    return Object.fromEntries([...this.samples.entries()].map(([provider, values]) => {
      const sorted = [...values].sort((left, right) => left - right)
      return [provider, {
        count: sorted.length,
        p50Us: percentile(sorted, 0.5),
        p95Us: percentile(sorted, 0.95),
        maxUs: sorted.at(-1) ?? 0,
      }]
    }))
  }
}

function percentile(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] ?? 0
}
