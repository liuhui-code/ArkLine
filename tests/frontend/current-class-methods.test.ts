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
      { name: "aboutToAppear", signature: "aboutToAppear()", line: 4, column: 3 },
      { name: "build", signature: "build()", line: 7, column: 3 },
      { name: "handleTap", signature: "handleTap(event: ClickEvent)", line: 15, column: 17 },
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
      { name: "two", signature: "two()", line: 6, column: 3 },
    ]);
  });
});
