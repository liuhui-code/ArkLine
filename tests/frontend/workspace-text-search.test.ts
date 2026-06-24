import {
  getRelativeWorkspacePath,
  parseSearchQuery,
  searchWorkspaceText,
} from "@/features/search/workspace-text-search";

describe("workspace text search", () => {
  it("parses regex queries and reports invalid expressions", () => {
    expect(parseSearchQuery("/Entry.*/").kind).toBe("regex");
    expect(parseSearchQuery("/(/").kind).toBe("invalid");
    expect(parseSearchQuery("Entry").kind).toBe("text");
  });

  it("returns relative workspace paths", () => {
    expect(getRelativeWorkspacePath("C:\\samples\\DemoWorkspace", "C:\\samples\\DemoWorkspace\\src\\main.ets")).toBe("src/main.ets");
    expect(getRelativeWorkspacePath("/tmp/demo", "/tmp/demo/entry/src/main.ets")).toBe("entry/src/main.ets");
  });

  it("finds text and regex matches with preview context", async () => {
    const files = {
      "C:\\samples\\DemoWorkspace\\src\\main.ets": [
        "@Entry",
        "@Component",
        "struct Index {",
        "  build() {",
        "    Text(\"ArkLine\")",
        "  }",
        "}",
      ].join("\n"),
      "C:\\samples\\DemoWorkspace\\AppScope\\app.json5": [
        "{",
        '  "app": {',
        '    "bundleName": "com.demo.app"',
        "  }",
        "}",
      ].join("\n"),
    };

    const textResults = await searchWorkspaceText({
      query: "bundle",
      rootPath: "C:\\samples\\DemoWorkspace",
      paths: Object.keys(files),
      readFile: async (path) => files[path as keyof typeof files] ?? null,
    });

    expect(textResults.matches).toHaveLength(1);
    expect(textResults.matches[0]).toMatchObject({
      relativePath: "AppScope/app.json5",
      fileName: "app.json5",
      line: 3,
      column: 6,
      preview: '    "bundleName": "com.demo.app"',
    });
    expect(textResults.matches[0]?.summary).toContain("bundleName");
    expect(textResults.matches[0].contextBefore.at(-1)).toEqual({ line: 2, text: '  "app": {' });

    const regexResults = await searchWorkspaceText({
      query: "/Text\\(\".+\"\\)/",
      rootPath: "C:\\samples\\DemoWorkspace",
      paths: Object.keys(files),
      readFile: async (path) => files[path as keyof typeof files] ?? null,
    });

    expect(regexResults.matches).toHaveLength(1);
    expect(regexResults.matches[0]).toMatchObject({
      relativePath: "src/main.ets",
      line: 5,
      preview: '    Text("ArkLine")',
    });
    expect(regexResults.matches[0]?.summary).toContain('Text("ArkLine")');
  });

  it("supports case-sensitive and whole-word matching for text queries", async () => {
    const files = {
      "C:\\samples\\DemoWorkspace\\src\\main.ets": [
        "@Entry",
        "@Component",
        "struct Index {",
        "  indexBuilder() {",
        "    Text(\"ArkLine\")",
        "  }",
        "}",
      ].join("\n"),
    };

    const caseInsensitive = await searchWorkspaceText({
      query: "entry",
      rootPath: "C:\\samples\\DemoWorkspace",
      paths: Object.keys(files),
      readFile: async (path) => files[path as keyof typeof files] ?? null,
    });
    expect(caseInsensitive.matches).toHaveLength(1);

    const caseSensitive = await searchWorkspaceText({
      query: "entry",
      rootPath: "C:\\samples\\DemoWorkspace",
      paths: Object.keys(files),
      options: { caseSensitive: true, wholeWord: false },
      readFile: async (path) => files[path as keyof typeof files] ?? null,
    });
    expect(caseSensitive.matches).toHaveLength(0);

    const wholeWord = await searchWorkspaceText({
      query: "index",
      rootPath: "C:\\samples\\DemoWorkspace",
      paths: Object.keys(files),
      options: { caseSensitive: false, wholeWord: true },
      readFile: async (path) => files[path as keyof typeof files] ?? null,
    });
    expect(wholeWord.matches).toHaveLength(1);
    expect(wholeWord.matches[0]?.line).toBe(3);
  });
});
