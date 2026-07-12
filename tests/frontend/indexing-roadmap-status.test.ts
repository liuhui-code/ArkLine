import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function readRoadmap() {
  return readFile(
    path.join(process.cwd(), "docs/indexing-system-roadmap.md"),
    "utf8",
  );
}

describe("indexing roadmap status", () => {
  it("does not list implemented index foundations as missing", async () => {
    const roadmap = await readRoadmap();

    expect(roadmap).not.toContain("There is no central scheduler");
    expect(roadmap).not.toContain("There is no file fingerprint table");
    expect(roadmap).not.toContain("There is no query facade");
    expect(roadmap).not.toContain("SDK symbols are not indexed");
    expect(roadmap).not.toContain("Index diagnostics are not visible enough");
  });

  it("records current progress for core index foundations", async () => {
    const roadmap = await readRoadmap();

    expect(roadmap).toContain("Central scheduler and task state machine");
    expect(roadmap).toContain("Durable file fingerprint table");
    expect(roadmap).toContain("Readiness-aware query facade");
    expect(roadmap).toContain("SDK/API symbols are persisted");
    expect(roadmap).toContain("Index diagnostics, health, repair, and explain");
  });
});
