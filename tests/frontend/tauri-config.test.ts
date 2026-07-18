import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("tauri bundle icon config", () => {
  it("bundles the standalone semantic worker as an external binary", () => {
    const configPath = resolve(process.cwd(), "src-tauri/tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      bundle?: { externalBin?: string[]; resources?: Record<string, string> };
    };

    expect(config.bundle?.externalBin).toEqual([
      "binaries/arkline-semantic",
      "binaries/arkline-indexer",
    ]);
    expect(config.bundle?.resources ?? {}).not.toHaveProperty(
      "../semantic-worker/bundle/semantic-worker.cjs",
    );
  });

  it("declares the generated desktop icon assets explicitly", () => {
    const configPath = resolve(process.cwd(), "src-tauri/tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      bundle?: { icon?: string[] };
    };

    expect(config.bundle?.icon).toEqual([
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico",
    ]);
  });

  it("does not force the Windows NSIS bundle target for every host platform", () => {
    const configPath = resolve(process.cwd(), "src-tauri/tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      bundle?: { targets?: string[] };
    };

    expect(config.bundle?.targets ?? []).not.toContain("nsis");
  });

  it("keeps NSIS as a Windows-specific bundle target", () => {
    const configPath = resolve(process.cwd(), "src-tauri/tauri.windows.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      bundle?: { targets?: string[] };
    };

    expect(config.bundle?.targets).toEqual(["nsis"]);
  });
});
