export type LanguageRequestKind = "completion" | "definition" | "usages" | "documentSymbols" | "hover";

export type LanguageRequestSource =
  | "completion:manual"
  | "completion:typing"
  | "definition:editor"
  | "usages:editor"
  | "documentSymbols:palette"
  | "hover:editor";

export type LanguageRequestSession = {
  kind: LanguageRequestKind;
  requestId: number;
  generation: number;
  source: LanguageRequestSource;
  timeoutMs: number;
  startedAt: number;
};

export function createLanguageSessionStore() {
  let nextRequestId = 0;
  let generation = 0;
  const active = new Map<LanguageRequestKind, LanguageRequestSession>();

  return {
    begin(kind: LanguageRequestKind, source: LanguageRequestSource, timeoutMs: number, now = Date.now()) {
      const session: LanguageRequestSession = {
        kind,
        requestId: ++nextRequestId,
        generation: ++generation,
        source,
        timeoutMs,
        startedAt: now,
      };
      active.set(kind, session);
      return session;
    },
    cancel(kind: LanguageRequestKind) {
      generation += 1;
      active.delete(kind);
    },
    complete(session: LanguageRequestSession) {
      if (this.isCurrent(session)) active.delete(session.kind);
    },
    isCurrent(session: LanguageRequestSession) {
      const current = active.get(session.kind);
      return current?.requestId === session.requestId && current.generation === session.generation;
    },
    snapshot() {
      return [...active.values()];
    },
  };
}

export function languageRequestTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`Language request timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
