import type { WorkspaceApi, TerminalSessionSummary } from "@/features/workspace/workspace-api";

type CreateTerminalSessionManagerOptions = {
  workspaceApi: WorkspaceApi;
  subscribeOutput: (sessionId: string, onData: (data: string) => void) => () => void;
};

export function createTerminalSessionManager({
  workspaceApi,
  subscribeOutput,
}: CreateTerminalSessionManagerOptions) {
  const outputBySession = new Map<string, string>();
  const teardownBySession = new Map<string, () => void>();

  return {
    async createSession(cwd: string | null): Promise<TerminalSessionSummary> {
      const session = await workspaceApi.createTerminalSession({ cwd });
      const teardown = subscribeOutput(session.id, (data) => {
        outputBySession.set(session.id, `${outputBySession.get(session.id) ?? ""}${data}`);
      });
      teardownBySession.set(session.id, teardown);
      return session;
    },
    getOutput(sessionId: string) {
      return outputBySession.get(sessionId) ?? "";
    },
    disposeSession(sessionId: string) {
      teardownBySession.get(sessionId)?.();
      teardownBySession.delete(sessionId);
      outputBySession.delete(sessionId);
    },
  };
}
