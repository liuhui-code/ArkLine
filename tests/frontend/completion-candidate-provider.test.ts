import { collectCompletionCandidates } from "@/components/layout/completion-candidate-provider";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

function candidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    id: "symbol:/workspace/src/main.ets:4:3",
    source: "symbol",
    kind: "method",
    title: "build",
    subtitle: "/workspace/src/main.ets",
    path: "/workspace/src/main.ets",
    line: 4,
    column: 3,
    score: 0,
    freshness: "ready",
    ...overrides,
  };
}

function workspaceApi(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    completeSymbol: async () => [{ label: "semanticBuild()", detail: "Semantic method", kind: "method", source: "arkts" }],
    ...overrides,
  } as WorkspaceApi;
}

function envelope(items: SearchCandidate[], state: "ready" | "partial" | "stale" = "ready") {
  return {
    items,
    readiness: {
      rootPath: "/workspace",
      requestedGeneration: 1,
      servedGeneration: 1,
      state,
      retryable: state !== "ready",
    },
  };
}

const baseRequest = {
  rootPath: "/workspace",
  path: "/workspace/src/main.ets",
  line: 3,
  column: 12,
  content: "struct Index {}",
  query: "",
  replacePrefix: "",
};

describe("completion candidate provider", () => {
  it("combines semantic, file-index, workspace-index, and keyword completions", async () => {
    const api = workspaceApi({
      queryWorkspaceFileSymbols: async () => [candidate({ title: "localBuild" })],
      queryWorkspaceCandidates: async () => [candidate({ source: "class", kind: "class", title: "PrivateProfile" })],
    });

    const items = await collectCompletionCandidates({
      ...baseRequest,
      workspaceApi: api,
      query: "pri",
      replacePrefix: "pri",
    });

    expect(items.map((item) => item.label)).toEqual([
      "semanticBuild()",
      "localBuild()",
      "PrivateProfile",
      "private",
    ]);
  });

  it("uses readiness-envelope APIs when available", async () => {
    const queryWorkspaceFileSymbols = vi.fn(async () => [candidate({ title: "legacyLocal" })]);
    const queryWorkspaceCandidates = vi.fn(async () => [candidate({ title: "LegacyWorkspace" })]);
    const queryWorkspaceFileSymbolsWithReadiness = vi.fn(async () => envelope([candidate({ title: "localBuild" })]));
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => envelope([
      candidate({ source: "class", kind: "class", title: "PrivateProfile" }),
    ]));
    const api = workspaceApi({
      queryWorkspaceFileSymbols,
      queryWorkspaceCandidates,
      queryWorkspaceFileSymbolsWithReadiness,
      queryWorkspaceCandidatesWithReadiness,
    });

    const items = await collectCompletionCandidates({
      ...baseRequest,
      workspaceApi: api,
      query: "pri",
      replacePrefix: "pri",
    });

    expect(queryWorkspaceFileSymbolsWithReadiness).toHaveBeenCalled();
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalled();
    expect(queryWorkspaceFileSymbols).not.toHaveBeenCalled();
    expect(queryWorkspaceCandidates).not.toHaveBeenCalled();
    expect(items.map((item) => item.label)).toEqual([
      "semanticBuild()",
      "localBuild()",
      "PrivateProfile",
      "private",
    ]);
  });

  it("hides stale indexed completions when semantic completion has an exact match", async () => {
    const api = workspaceApi({
      completeSymbol: async () => [{ label: "build()", detail: "Semantic method", kind: "method", source: "arkts" }],
      queryWorkspaceFileSymbolsWithReadiness: async () => envelope([candidate({ title: "build", freshness: "stale" })], "stale"),
      queryWorkspaceCandidatesWithReadiness: async () => envelope([
        candidate({ source: "class", kind: "class", title: "BuildProfile", freshness: "stale" }),
      ], "stale"),
    });

    const items = await collectCompletionCandidates({
      ...baseRequest,
      workspaceApi: api,
      query: "build",
      replacePrefix: "build",
    });

    expect(items.map((item) => item.label)).toEqual(["build()"]);
  });

  it("does not query workspace-wide symbols without a prefix", async () => {
    const queryWorkspaceCandidates = vi.fn(async () => [candidate()]);
    const api = workspaceApi({
      queryWorkspaceFileSymbols: async () => [candidate({ title: "localBuild" })],
      queryWorkspaceCandidates,
    });

    const items = await collectCompletionCandidates({ ...baseRequest, workspaceApi: api });

    expect(queryWorkspaceCandidates).not.toHaveBeenCalled();
    expect(items.map((item) => item.label)).toEqual(["semanticBuild()", "localBuild()"]);
  });

  it("keeps semantic completions when indexed completion queries fail", async () => {
    const api = workspaceApi({
      queryWorkspaceFileSymbols: async () => {
        throw new Error("file index unavailable");
      },
      queryWorkspaceCandidates: async () => {
        throw new Error("workspace index unavailable");
      },
    });

    const items = await collectCompletionCandidates({
      ...baseRequest,
      workspaceApi: api,
      query: "bu",
      replacePrefix: "bu",
    });

    expect(items.map((item) => item.label)).toEqual(["semanticBuild()"]);
  });

  it("falls back to indexed and keyword completions when language service completion is unavailable", async () => {
    const api = workspaceApi({
      completeSymbol: undefined,
      queryWorkspaceFileSymbols: async () => [candidate({ title: "localBuild" })],
      queryWorkspaceCandidates: async () => [candidate({ source: "class", kind: "class", title: "PrivateProfile" })],
    });

    const items = await collectCompletionCandidates({
      ...baseRequest,
      workspaceApi: api,
      query: "pri",
      replacePrefix: "pri",
    });

    expect(items.map((item) => item.label)).toEqual(["localBuild()", "PrivateProfile", "private"]);
  });

  it("starts indexed completion lookups without waiting for semantic completion to finish", async () => {
    const events: string[] = [];
    let resolveSemantic: (items: Awaited<ReturnType<NonNullable<WorkspaceApi["completeSymbol"]>>>) => void = () => undefined;
    const semanticPromise = new Promise<Awaited<ReturnType<NonNullable<WorkspaceApi["completeSymbol"]>>>>((resolve) => {
      resolveSemantic = resolve;
    });
    const api = workspaceApi({
      completeSymbol: async () => {
        events.push("semantic-start");
        return semanticPromise;
      },
      queryWorkspaceFileSymbols: async () => {
        events.push("file-index-start");
        return [candidate({ title: "localBuild" })];
      },
      queryWorkspaceCandidates: async () => {
        events.push("workspace-index-start");
        return [candidate({ source: "class", kind: "class", title: "PrivateProfile" })];
      },
    });

    const resultPromise = collectCompletionCandidates({
      ...baseRequest,
      workspaceApi: api,
      query: "pri",
      replacePrefix: "pri",
    });
    await Promise.resolve();

    expect(events).toEqual(["semantic-start", "file-index-start", "workspace-index-start"]);

    resolveSemantic([{ label: "semanticBuild()", detail: "Semantic method", kind: "method", source: "arkts" }]);
    await expect(resultPromise).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "semanticBuild()" }),
      expect.objectContaining({ label: "localBuild()" }),
      expect.objectContaining({ label: "PrivateProfile" }),
    ]));
  });
});
