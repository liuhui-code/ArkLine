import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function readReadme() {
  return readFile(path.join(process.cwd(), "README.md"), "utf8");
}

function extractSection(text: string, heading: string, nextHeading: string) {
  const start = text.indexOf(heading);
  const end = nextHeading
    ? text.indexOf(nextHeading, start + heading.length)
    : text.length;
  return text.slice(start, end);
}

describe("README quality gates", () => {
  it("documents check:fast as the default local verification gate", async () => {
    const readme = await readReadme();
    const macosSection = extractSection(readme, "### macOS", "## First-use flow");
    const developmentSection = extractSection(readme, "## Development", "");

    expect(macosSection).toContain("pnpm check:fast");
    expect(developmentSection).toContain("pnpm check:fast");
    expect(developmentSection).not.toContain(
      "pnpm test\ncargo test --manifest-path src-tauri/Cargo.toml\npnpm build",
    );
  });
});
