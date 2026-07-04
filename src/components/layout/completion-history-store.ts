type CompletionHistoryEntry = {
  label: string;
  acceptedAt: number;
};

type CompletionHistoryStoreOptions = {
  storage?: Storage | null;
  key?: string;
  limit?: number;
  now?: () => number;
};

const defaultKey = "arkline.completion.history.v1";

export function createCompletionHistoryStore({
  storage = safeLocalStorage(),
  key = defaultKey,
  limit = 50,
  now = Date.now,
}: CompletionHistoryStoreOptions = {}) {
  let entries = loadEntries(storage, key).slice(-limit);

  function persist() {
    if (!storage) {
      return;
    }
    storage.setItem(key, JSON.stringify(entries));
  }

  return {
    recordAccepted(label: string) {
      const trimmed = label.trim();
      if (!trimmed) {
        return;
      }
      entries = [
        ...entries.filter((entry) => entry.label !== trimmed),
        { label: trimmed, acceptedAt: now() },
      ].slice(-limit);
      persist();
    },
    acceptedLabels() {
      return [...entries]
        .sort((left, right) => left.acceptedAt - right.acceptedAt)
        .map((entry) => entry.label);
    },
  };
}

function loadEntries(storage: Storage | null, key: string): CompletionHistoryEntry[] {
  if (!storage) {
    return [];
  }
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

function isEntry(value: unknown): value is CompletionHistoryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Partial<CompletionHistoryEntry>;
  return typeof entry.label === "string" && typeof entry.acceptedAt === "number";
}

function safeLocalStorage() {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}
