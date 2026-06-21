import type { TerminalSessionSummary, TerminalTabsState } from "@/features/terminal/terminal-types";

export function createTerminalTabsStore() {
  const state: TerminalTabsState = {
    sessions: [],
    activeSessionId: null,
  };

  return {
    state,
    addSession(session: TerminalSessionSummary) {
      state.sessions = [...state.sessions.filter((item) => item.id !== session.id), session];
      state.activeSessionId = session.id;
    },
    setActiveSession(sessionId: string) {
      if (state.sessions.some((session) => session.id === sessionId)) {
        state.activeSessionId = sessionId;
      }
    },
    closeSession(sessionId: string) {
      const nextSessions = state.sessions.filter((session) => session.id !== sessionId);
      state.sessions = nextSessions;
      state.activeSessionId = nextSessions.at(-1)?.id ?? null;
    },
  };
}
