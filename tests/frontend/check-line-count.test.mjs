import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectLineCountViolations, collectProjectFiles } from "../../scripts/check-line-count.mjs";

describe("check-line-count", () => {
  it("reports target code files above the configured line limit", () => {
    const files = [
      { path: "src/large.ts", text: Array.from({ length: 4 }, (_, index) => `line ${index}`).join("\n") },
      { path: "src/small.ts", text: "one\ntwo\nthree" },
      { path: "src/style.css", text: "a\nb\nc\nd\ne" },
      { path: "node_modules/pkg/index.ts", text: "a\nb\nc\nd\ne" },
    ];

    expect(collectLineCountViolations(files, { limit: 3 })).toEqual([
      { path: "src/large.ts", lineCount: 4, limit: 3 },
    ]);
  });

  it("collects an explicit file root for backend line-count checks", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "arkline-line-count-"));
    await mkdir(path.join(cwd, "src-tauri", "src", "services"), { recursive: true });
    await writeFile(
      path.join(cwd, "src-tauri", "src", "services", "example.rs"),
      "one\ntwo\nthree\n",
    );

    const files = await collectProjectFiles(cwd, ["src-tauri/src/services/example.rs"]);

    expect(files).toEqual([
      { path: "src-tauri/src/services/example.rs", text: "one\ntwo\nthree\n" },
    ]);
  });
});
