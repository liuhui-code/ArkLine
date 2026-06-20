export type SearchMatch = {
  path: string;
  line: number;
  column: number;
  text: string;
};

export type SearchGroup = {
  path: string;
  matches: SearchMatch[];
};

export type SearchState = {
  requestId: number;
  query: string;
  status: "idle" | "running" | "cancelled" | "complete";
  results: SearchMatch[];
};

function sortMatches(left: SearchMatch, right: SearchMatch) {
  if (left.path !== right.path) {
    return left.path.localeCompare(right.path);
  }

  if (left.line !== right.line) {
    return left.line - right.line;
  }

  return left.column - right.column;
}

export function createSearchStore() {
  const state: SearchState = {
    requestId: 0,
    query: "",
    status: "idle",
    results: [],
  };

  return {
    state,
    begin(query: string) {
      state.requestId += 1;
      state.query = query;
      state.status = "running";
      state.results = [];
      return state.requestId;
    },
    receive(requestId: number, match: SearchMatch) {
      if (requestId !== state.requestId || state.status !== "running") {
        return;
      }

      state.results.push(match);
      state.results.sort(sortMatches);
    },
    finish(requestId: number) {
      if (requestId !== state.requestId || state.status !== "running") {
        return;
      }

      state.status = "complete";
    },
    cancel() {
      if (state.status === "running") {
        state.status = "cancelled";
      }
    },
    groupedResults(): SearchGroup[] {
      const grouped = new Map<string, SearchMatch[]>();

      state.results.forEach((match) => {
        const bucket = grouped.get(match.path);
        if (bucket) {
          bucket.push(match);
          return;
        }

        grouped.set(match.path, [match]);
      });

      return Array.from(grouped.entries()).map(([path, matches]) => ({ path, matches }));
    },
  };
}
