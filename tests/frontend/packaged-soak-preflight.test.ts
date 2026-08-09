import { describe, expect, it } from "vitest";

import { resolveWindowsPowerShell } from "../../scripts/packaged-soak-preflight.mjs";

describe("packaged soak PowerShell resolution", () => {
  it("uses the workflow-published host path before PATH probing", async () => {
    const attempts: string[] = [];
    const hostPath = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";

    const resolved = await resolveWindowsPowerShell(async (candidate: string) => {
      attempts.push(candidate);
      return candidate;
    }, {
      ARKLINE_POWERSHELL_PATH: hostPath,
    });

    expect(resolved).toBe(hostPath);
    expect(attempts).toEqual([hostPath]);
  });

  it("derives the PowerShell host from PSModulePath when PATH is incomplete", async () => {
    const attempts: string[] = [];
    const hostPath = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";

    const resolved = await resolveWindowsPowerShell(async (candidate: string) => {
      attempts.push(candidate);
      if (candidate !== hostPath) throw new Error("missing");
      return candidate;
    }, {
      PSModulePath: "C:\\Program Files\\PowerShell\\7\\Modules;C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules",
    });

    expect(resolved).toBe(hostPath);
    expect(attempts).toEqual([hostPath]);
  });

  it("reports attempted paths and environment evidence when no host resolves", async () => {
    await expect(resolveWindowsPowerShell(
      async () => { throw new Error("missing"); },
      { ARKLINE_POWERSHELL_PATH: "C:\\missing\\pwsh.exe", PATH: "C:\\tools" },
    )).rejects.toThrow("ARKLINE_POWERSHELL_PATH=C:\\missing\\pwsh.exe");
  });
});
