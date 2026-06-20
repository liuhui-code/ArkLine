import { describe, expect, it } from "vitest";
import { findLocalDefinition } from "@/features/workspace/local-definition";

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
});
