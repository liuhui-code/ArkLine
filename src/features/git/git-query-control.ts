let sequence = 0;

export const GIT_STATUS_PAGE_SIZE = 200;
export const GIT_QUERY_TIMEOUT_MS = 15_000;
export const GIT_DIFF_LIMIT_BYTES = 4 * 1024 * 1024;

export function createGitQueryId(kind: string) {
  sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${kind}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}
