export type IpcLatencySample = {
  command: string;
  durationMs: number;
  startedAt: number;
  status: "ok" | "error";
};

export function createIpcLatencyStore(limit = 80) {
  const samples: IpcLatencySample[] = [];

  return {
    record(sample: IpcLatencySample) {
      samples.push(sample);
      while (samples.length > limit) {
        samples.shift();
      }
    },
    snapshot() {
      return [...samples].sort((left, right) => right.startedAt - left.startedAt);
    },
  };
}
