import { describe, expect, it } from "vitest";
import { findLocalDefinition, findWorkspaceDefinition, findWorkspaceDefinitionCandidates } from "@/features/workspace/local-definition";

describe("findLocalDefinition", () => {
  it("resolves a struct declaration from a same-file usage", () => {
    const target = findLocalDefinition({
      path: "C:/samples/DemoWorkspace/src/main.ets",
      content: "struct Index {}\nfunction mount() {\n  Index();\n}",
      line: 3,
      column: 4,
    });

    expect(target).toEqual({
      path: "C:/samples/DemoWorkspace/src/main.ets",
      line: 1,
      column: 8,
    });
  });

  it("resolves a method declaration from a same-file call", () => {
    const target = findLocalDefinition({
      path: "C:/samples/DemoWorkspace/src/main.ets",
      content: "struct Index {\n  build() {}\n  mount() {\n    this.build();\n  }\n}",
      line: 4,
      column: 11,
    });

    expect(target).toEqual({
      path: "C:/samples/DemoWorkspace/src/main.ets",
      line: 2,
      column: 3,
    });
  });

  it("resolves a same-file property declaration from a member access", () => {
    const target = findLocalDefinition({
      path: "C:/samples/DemoWorkspace/src/main.ets",
      content: "struct Index {\n  private title: string = '';\n  build() {\n    this.title;\n  }\n}",
      line: 4,
      column: 10,
    });

    expect(target).toEqual({
      path: "C:/samples/DemoWorkspace/src/main.ets",
      line: 2,
      column: 11,
    });
  });
});

describe("findWorkspaceDefinition", () => {
  it("resolves a named import into another workspace file", async () => {
    const target = await findWorkspaceDefinition({
      path: "C:/samples/DemoWorkspace/src/main.ets",
      content: "import { EntryAbility } from './entryability/EntryAbility';\nEntryAbility();\n",
      line: 2,
      column: 3,
      workspaceFiles: [
        "C:/samples/DemoWorkspace/src/main.ets",
        "C:/samples/DemoWorkspace/src/entryability/EntryAbility.ets",
      ],
      readFile: async (path) => {
        if (path.endsWith("EntryAbility.ets")) {
          return "export function EntryAbility() {}\n";
        }

        return null;
      },
    });

    expect(target).toEqual({
      path: "C:\\samples\\DemoWorkspace\\src\\entryability\\EntryAbility.ets",
      line: 1,
      column: 17,
    });
  });

  it("resolves an aliased import into the original exported symbol", async () => {
    const target = await findWorkspaceDefinition({
      path: "C:/samples/DemoWorkspace/src/main.ets",
      content: "import { Index as RootIndex } from './pages/Index';\nRootIndex();\n",
      line: 2,
      column: 3,
      workspaceFiles: [
        "C:/samples/DemoWorkspace/src/main.ets",
        "C:/samples/DemoWorkspace/src/pages/Index.ets",
      ],
      readFile: async (path) => {
        if (path.endsWith("Index.ets")) {
          return "export struct Index {}\n";
        }

        return null;
      },
    });

    expect(target).toEqual({
      path: "C:\\samples\\DemoWorkspace\\src\\pages\\Index.ets",
      line: 1,
      column: 15,
    });
  });

  it("resolves a uniquely declared workspace symbol even when the current file has no import", async () => {
    const target = await findWorkspaceDefinition({
      path: "C:/samples/DemoWorkspace/src/main.ets",
      content: "function mount() {\n  EntryAbility();\n}\n",
      line: 2,
      column: 4,
      workspaceFiles: [
        "C:/samples/DemoWorkspace/src/main.ets",
        "C:/samples/DemoWorkspace/src/entryability/EntryAbility.ets",
        "C:/samples/DemoWorkspace/src/pages/Index.ets",
      ],
      readFile: async (path) => {
        if (path.endsWith("EntryAbility.ets")) {
          return "export function EntryAbility() {}\n";
        }
        if (path.endsWith("Index.ets")) {
          return "export struct Index {}\n";
        }

        return null;
      },
    });

    expect(target).toEqual({
      path: "C:\\samples\\DemoWorkspace\\src\\entryability\\EntryAbility.ets",
      line: 1,
      column: 17,
    });
  });
});

describe("findWorkspaceDefinitionCandidates", () => {
  it("returns multiple workspace candidates when the symbol is ambiguous", async () => {
    const targets = await findWorkspaceDefinitionCandidates({
      path: "C:/samples/DemoWorkspace/src/pages/home/main.ets",
      content: "function mount() {\n  EntryAbility();\n}\n",
      line: 2,
      column: 4,
      workspaceFiles: [
        "C:/samples/DemoWorkspace/src/pages/home/main.ets",
        "C:/samples/DemoWorkspace/src/pages/home/EntryAbility.ets",
        "C:/samples/DemoWorkspace/src/mock/EntryAbility.ets",
      ],
      readFile: async (path) => {
        if (path.endsWith("pages/home/EntryAbility.ets")) {
          return "function EntryAbility() {}\n";
        }
        if (path.endsWith("mock/EntryAbility.ets")) {
          return "export function EntryAbility() {}\n";
        }

        return null;
      },
    });

    expect(targets).toEqual([
      {
        path: "C:\\samples\\DemoWorkspace\\src\\mock\\EntryAbility.ets",
        line: 1,
        column: 17,
        preview: "export function EntryAbility() {}",
      },
      {
        path: "C:\\samples\\DemoWorkspace\\src\\pages\\home\\EntryAbility.ets",
        line: 1,
        column: 10,
        preview: "function EntryAbility() {}",
      },
    ]);
  });
});
