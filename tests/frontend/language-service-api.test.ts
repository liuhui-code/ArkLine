import {
  defaultWorkspaceApi,
  type LanguageQueryRequest,
} from "@/features/workspace/workspace-api";

describe("language service api skeleton", () => {
  const inspectLanguageService = defaultWorkspaceApi.inspectLanguageService!;
  const hoverSymbol = defaultWorkspaceApi.hoverSymbol!;
  const gotoDefinition = defaultWorkspaceApi.gotoDefinition!;
  const gotoDefinitionCandidates = defaultWorkspaceApi.gotoDefinitionCandidates!;
  const completeSymbol = defaultWorkspaceApi.completeSymbol!;
  const findUsages = defaultWorkspaceApi.findUsages!;
  const getFileBlame = defaultWorkspaceApi.getFileBlame!;
  const getCommitTrace = defaultWorkspaceApi.getCommitTrace!;

  const request: LanguageQueryRequest = {
    path: "C:/samples/DemoWorkspace/src/main.ets",
    line: 2,
    column: 1,
  };

  it("reports the mock language-service capabilities outside Tauri", async () => {
    await expect(inspectLanguageService()).resolves.toEqual({
      provider: "mock-fallback",
      mode: "fallback",
      running: true,
      hover: true,
      definition: true,
      completion: true,
      documentSymbols: true,
      findUsages: true,
      detail: "Mock fallback ArkTS language service for demo and integration-shell wiring",
    });
  });

  it("returns mock hover, definition, and completion results for the demo workspace", async () => {
    await expect(hoverSymbol(request)).resolves.toEqual({
      contents: "@Entry decorates the HarmonyOS application entry component.",
    });
    await expect(gotoDefinition(request)).resolves.toEqual({
      path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
      line: 1,
      column: 1,
    });
    await expect(gotoDefinitionCandidates(request)).resolves.toEqual([]);
    await expect(completeSymbol(request)).resolves.toEqual([
      { label: "@Entry", detail: "ArkTS decorator", kind: "keyword" },
      { label: "@Component", detail: "ArkTS decorator", kind: "keyword" },
      { label: "build()", detail: "Component lifecycle method", kind: "method" },
    ]);
    await expect(findUsages({
      path: "C:/samples/DemoWorkspace/src/main.ets",
      line: 1,
      column: 7,
    })).resolves.toEqual([
      {
        path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
        line: 1,
        column: 1,
        preview: "@Entry",
      },
      {
        path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
        line: 3,
        column: 8,
        preview: "struct Index {}",
      },
    ]);
  });

  it("returns empty semantic results for unknown workspaces in the mock path", async () => {
    const unknown = {
      path: "C:/other/project/src/other.ets",
      line: 1,
      column: 1,
    };

    await expect(hoverSymbol(unknown)).resolves.toBeNull();
    await expect(gotoDefinition(unknown)).resolves.toBeNull();
    await expect(gotoDefinitionCandidates(unknown)).resolves.toEqual([]);
    await expect(completeSymbol(unknown)).resolves.toEqual([]);
    await expect(findUsages(unknown)).resolves.toEqual([]);
  });

  it("exposes git trace contract shapes", async () => {
    const blame = await getFileBlame("C:/samples/DemoWorkspace/src/main.ets");
    const detail = await getCommitTrace("C:/samples/DemoWorkspace/src/main.ets", "abc1234", 3);

    expect(blame).toBeDefined();
    expect(detail).toBeDefined();
  });
});
