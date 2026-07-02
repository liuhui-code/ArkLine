import { describe, expect, it } from "vitest";
import { collectCurrentClassMethods } from "@/features/workspace/current-class-methods";

describe("current class methods", () => {
  it("collects top-level methods from the ArkTS struct around the caret", () => {
    const source = [
      "@Entry",
      "@Component",
      "struct Index {",
      "  aboutToAppear() {",
      "  }",
      "",
      "  build() {",
      "    Text('hello')",
      "      .width(100)",
      "      .onClick(() => {",
      "        this.handleTap()",
      "      })",
      "  }",
      "",
      "  private async handleTap(event: ClickEvent) {",
      "  }",
      "}",
    ].join("\n");

    expect(collectCurrentClassMethods(source, 8)).toEqual([
      { kind: "method", name: "aboutToAppear", signature: "aboutToAppear()", line: 4, column: 3 },
      { kind: "method", name: "build", signature: "build()", line: 7, column: 3 },
      { kind: "method", name: "handleTap", signature: "handleTap(event: ClickEvent)", line: 15, column: 17 },
    ]);
  });

  it("returns only methods from the enclosing class", () => {
    const source = [
      "class First {",
      "  one() {}",
      "}",
      "",
      "class Second {",
      "  two() {}",
      "}",
    ].join("\n");

    expect(collectCurrentClassMethods(source, 6)).toEqual([
      { kind: "method", name: "two", signature: "two()", line: 6, column: 3 },
    ]);
  });

  it("collects top-level members from the enclosing class", () => {
    const source = [
      "struct Index {",
      "  private count: number = 0",
      "  @State message: string = 'hello'",
      "  title = 'Demo'",
      "  build() {}",
      "}",
    ].join("\n");

    expect(collectCurrentClassMethods(source, 5)).toEqual([
      { kind: "member", name: "count", signature: "count: number", line: 2, column: 11 },
      { kind: "member", name: "title", signature: "title", line: 4, column: 3 },
      { kind: "method", name: "build", signature: "build()", line: 5, column: 3 },
    ]);
  });
});
