import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("tauri bundle icon config", () => {
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
});
