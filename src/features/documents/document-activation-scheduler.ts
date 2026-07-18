export const DOCUMENT_ACTIVATION_YIELD_THRESHOLD = 64 * 1024;

export type DocumentActivationRequest = {
  cached: boolean;
  contentLength: number;
};

type SchedulingHost = {
  scheduler?: {
    yield?: () => Promise<void>;
  };
  setTimeout(callback: () => void, delay: number): unknown;
};

export function shouldYieldDocumentActivation({
  cached,
  contentLength,
}: DocumentActivationRequest) {
  return cached || contentLength >= DOCUMENT_ACTIVATION_YIELD_THRESHOLD;
}

export async function scheduleDocumentActivation(
  request: DocumentActivationRequest,
  host: SchedulingHost = globalThis as SchedulingHost,
) {
  if (!shouldYieldDocumentActivation(request)) return;
  await yieldDocumentActivationTask(host);
}

export async function yieldDocumentActivationTask(
  host: SchedulingHost = globalThis as SchedulingHost,
) {
  if (host.scheduler?.yield) {
    await host.scheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => {
    host.setTimeout(resolve, 0);
  });
}
