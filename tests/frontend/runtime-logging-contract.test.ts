import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

describe("packaged runtime logging", () => {
  it("installs the Tauri file logger before application setup", async () => {
    const [manifest, appHost] = await Promise.all([
      readProjectFile("src-tauri/Cargo.toml"),
      readProjectFile("src-tauri/src/lib.rs"),
    ]);

    expect(manifest).toMatch(/^tauri-plugin-log = "2"$/m);
    expect(appHost).toContain(".plugin(runtime_logging::plugin())");
    expect(appHost.indexOf(".plugin(runtime_logging::plugin())")).toBeLessThan(
      appHost.indexOf(".setup(|app|")
    );
  });

  it("records discovery lifecycle and preserves indexer stderr", async () => {
    const [appHost, discoveryWorker, indexerSession] = await Promise.all([
      readProjectFile("src-tauri/src/lib.rs"),
      readProjectFile("src-tauri/src/services/workspace_index_discovery_worker_service.rs"),
      readProjectFile("src-tauri/src/indexer_host/session.rs"),
    ]);

    expect(appHost).toContain("runtime_logging::log_app_started()");
    expect(discoveryWorker).toContain("runtime_logging::log_discovery_chunk_started(");
    expect(discoveryWorker).toContain("runtime_logging::log_discovery_chunk_completed(");
    expect(discoveryWorker).toContain("runtime_logging::log_discovery_fallback(");
    expect(indexerSession).toContain("runtime_logging::log_indexer_stderr(");
    expect(indexerSession).not.toContain("std::io::sink()");
  });
});
