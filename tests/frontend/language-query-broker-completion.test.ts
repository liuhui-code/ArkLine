import { describe, expect, it, vi } from "vitest";
import { collectCompletionCandidates } from "@/components/layout/completion-candidate-provider";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

describe("language query broker completion", () => {
  it("uses one broker request for receiver-aware production completion", async () => {
    const completeSymbol = vi.fn();
    const semanticCompleteSymbol = vi.fn();
    const queryWorkspaceFileSymbolsWithReadiness = vi.fn();
    const queryWorkspaceCandidatesWithReadiness = vi.fn();
    const queryLanguageCompletion = vi.fn(async () => ({
      items: [
        { label: "build()", detail: "UserService method", kind: "method", source: "type" as const },
        { label: "profile", detail: "UserService property", kind: "property", source: "type" as const },
      ],
      readiness: {
        rootPath: "/workspace",
        requestedGeneration: 7,
        servedGeneration: 7,
        state: "ready" as const,
        retryable: false,
      },
      requestGeneration: 19,
      documentGeneration: 3,
      targetGeneration: 7,
      provider: "semantic",
      confidence: "semantic",
      fallbackUsed: false,
      missReason: null,
      explain: ["context:memberAccess", "provider:semantic"],
    }));
    const workspaceApi = {
      queryLanguageCompletion,
      completeSymbol,
      semanticCompleteSymbol,
      queryWorkspaceFileSymbolsWithReadiness,
      queryWorkspaceCandidatesWithReadiness,
    } as unknown as WorkspaceApi;

    const items = await collectCompletionCandidates({
      workspaceApi,
      rootPath: "/workspace",
      path: "/workspace/Index.ets",
      line: 1,
      column: 11,
      content: "service.pr",
      semanticContent: "service.pr",
      documentVersion: 3,
      query: "pr",
      replacePrefix: "pr",
      requestGeneration: 19,
    });

    expect(items.map((item) => item.label)).toEqual(["profile"]);
    expect(queryLanguageCompletion).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path: "/workspace/Index.ets", content: "service.pr" }),
      19,
      3,
    );
    expect(completeSymbol).not.toHaveBeenCalled();
    expect(semanticCompleteSymbol).not.toHaveBeenCalled();
    expect(queryWorkspaceFileSymbolsWithReadiness).not.toHaveBeenCalled();
    expect(queryWorkspaceCandidatesWithReadiness).not.toHaveBeenCalled();
  });

  it("discards a stale broker generation before presenting completion", async () => {
    const workspaceApi = {
      queryLanguageCompletion: vi.fn(async () => ({
        items: [{ label: "stale", detail: "stale", kind: "property", source: "type" as const }],
        readiness: {
          rootPath: "/workspace",
          requestedGeneration: 7,
          servedGeneration: 7,
          state: "ready" as const,
          retryable: false,
        },
        requestGeneration: 18,
        documentGeneration: 3,
        targetGeneration: 7,
        provider: "semantic",
        confidence: "semantic",
        fallbackUsed: false,
        missReason: null,
        explain: [],
      })),
    } as unknown as WorkspaceApi;

    const result = await collectCompletionCandidates({
      workspaceApi,
      rootPath: "/workspace",
      path: "/workspace/Index.ets",
      line: 1,
      column: 2,
      content: "st",
      semanticContent: "st",
      documentVersion: 3,
      query: "st",
      replacePrefix: "st",
      requestGeneration: 19,
    });

    expect(result).toEqual([]);
  });

  it("discards completion produced for a different document generation", async () => {
    const workspaceApi = {
      queryLanguageCompletion: vi.fn(async () => ({
        items: [{ label: "stale", detail: "stale", kind: "property", source: "type" as const }],
        readiness: {
          rootPath: "/workspace",
          requestedGeneration: 7,
          servedGeneration: 7,
          state: "ready" as const,
          retryable: false,
        },
        requestGeneration: 19,
        documentGeneration: 2,
        targetGeneration: 2,
        provider: "semantic",
        confidence: "semantic",
        fallbackUsed: false,
        missReason: null,
        explain: [],
      })),
    } as unknown as WorkspaceApi;

    const result = await collectCompletionCandidates({
      workspaceApi,
      rootPath: "/workspace",
      path: "/workspace/Index.ets",
      line: 1,
      column: 2,
      content: "st",
      semanticContent: "st",
      documentVersion: 3,
      query: "st",
      replacePrefix: "st",
      requestGeneration: 19,
    });

    expect(result).toEqual([]);
  });

  it("keeps the non-desktop compatibility path when the broker is unavailable", async () => {
    const completeSymbol = vi.fn(async () => [
      {
        label: "localBuild()",
        detail: "Compatibility method",
        kind: "method",
        source: "fallback" as const,
      },
    ]);
    const workspaceApi = {
      queryLanguageCompletion: vi.fn(async () => ({
        items: [],
        readiness: {
          rootPath: "/workspace",
          requestedGeneration: 0,
          servedGeneration: null,
          state: "missing" as const,
          retryable: true,
        },
        requestGeneration: 7,
        documentGeneration: null,
        targetGeneration: null,
        provider: "none",
        confidence: "none",
        fallbackUsed: false,
        missReason: "Language query broker is unavailable outside the desktop runtime",
        explain: ["provider:none", "runtime:unavailable"],
      })),
      completeSymbol,
    } as unknown as WorkspaceApi;

    const items = await collectCompletionCandidates({
      workspaceApi,
      rootPath: "/workspace",
      path: "/workspace/Index.ets",
      line: 1,
      column: 2,
      content: "lo",
      query: "lo",
      replacePrefix: "lo",
      requestGeneration: 7,
    });

    expect(items.map((item) => item.label)).toEqual(["localBuild()"]);
    expect(completeSymbol).toHaveBeenCalled();
  });
});
