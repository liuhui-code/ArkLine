import { EditorState } from "@codemirror/state";
import { createCodeMirrorCompletionBroker } from "@/components/layout/codemirror-completion-broker";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

describe("CodeMirror completion broker", () => {
  it("provides the document snapshot to the indexed member fallback", async () => {
    const content = [
      "class EntryPage {",
      "  @Local vm: EntryViewModel = new EntryViewModel();",
      "  run() { this.vm. }",
      "}",
    ].join("\n");
    const document = EditorState.create({ doc: content }).doc;
    const queryLanguageCompletion = vi.fn(async () => completionEnvelope(3));
    const broker = createCodeMirrorCompletionBroker({
      workspaceApi: { queryLanguageCompletion } as unknown as WorkspaceApi,
      getRootPath: () => "/workspace",
      ensureSemanticDocument: async () => 3,
    });

    await broker({
      path: "/workspace/EntryPage.ets",
      document,
      lineText: "  run() { this.vm. }",
      line: 3,
      column: 20,
      explicit: true,
      query: "",
      replacePrefix: "",
    });

    expect(queryLanguageCompletion).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ content }),
      1,
      3,
    );
  });

  it("does not materialize a synced document for ordinary identifier completion", async () => {
    const document = EditorState.create({ doc: `${"const padding = 1;\n".repeat(8_000)}pri` }).doc;
    const toString = vi.spyOn(document, "toString");
    const broker = createCodeMirrorCompletionBroker({
      workspaceApi: {
        queryLanguageCompletion: async () => completionEnvelope(4),
      } as unknown as WorkspaceApi,
      getRootPath: () => "/workspace",
      ensureSemanticDocument: async () => 4,
    });

    await broker({
      path: "/workspace/EntryPage.ets",
      document,
      lineText: "pri",
      line: 8_001,
      column: 4,
      explicit: false,
      query: "pri",
      replacePrefix: "pri",
    });

    expect(toString).not.toHaveBeenCalled();
  });
});

function completionEnvelope(documentGeneration: number) {
  return {
    items: [],
    readiness: {
      rootPath: "/workspace",
      requestedGeneration: 1,
      servedGeneration: 1,
      state: "ready" as const,
      retryable: false,
    },
    requestGeneration: 1,
    documentGeneration,
    targetGeneration: documentGeneration,
    provider: "none",
    confidence: "none",
    fallbackUsed: false,
    missReason: "No completion",
    explain: [],
  };
}
