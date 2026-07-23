import { describe, expect, it, vi } from "vitest";
import {
  buildAttachedCapabilities,
  PackagedWebDriver,
} from "../../scripts/packaged-soak-webdriver.mjs";
import {
  buildWebView2Environment,
  nativeDriverArguments,
  packagedApplicationArguments,
  probeWebView2DebugEndpoints,
} from "../../scripts/packaged-soak-windows-session.mjs";

describe("packaged Windows WebView2 attachment", () => {
  it("builds an explicit WebView2 attachment session", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        value: {
          sessionId: "session-1",
          capabilities: { browserName: "webview2" },
        },
      }),
    });
    const driver = new PackagedWebDriver(
      "http://127.0.0.1:4445",
      fetchImpl,
    );

    await driver.createAttachedSession("127.0.0.1:9222");

    expect(driver.sessionId).toBe("session-1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:4445/session",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(buildAttachedCapabilities("127.0.0.1:9222")),
      }),
    );
  });

  it("passes a controlled WebDriver port to the packaged application", () => {
    expect(buildWebView2Environment(
      { EXISTING_VALUE: "preserved" },
      "C:\\fixture",
      9222,
    )).toMatchObject({
      ARKLINE_WORKSPACE_ROOT: "C:\\fixture",
      ARKLINE_WEBDRIVER_PORT: "9222",
      EXISTING_VALUE: "preserved",
    });
    expect(nativeDriverArguments(4445)).toEqual([
      "--port=4445",
      "--verbose",
    ]);
    expect(packagedApplicationArguments("C:\\fixture")).toEqual([
      "--workspace",
      "C:\\fixture",
    ]);
  });

  it("records WebView2 debug probes without requiring a version endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const reachable = url.endsWith("/json/list");
      return {
        ok: reachable,
        status: reachable ? 200 : 404,
        text: async () => reachable ? '[{"type":"page"}]' : "not found",
      };
    });

    const evidence = await probeWebView2DebugEndpoints(9222, fetchImpl);

    expect(evidence.reachable).toBe(true);
    expect(evidence.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ pathname: "/json/version", ok: false }),
      expect.objectContaining({ pathname: "/json/list", ok: true }),
    ]));
  });

  it("keeps an unreachable WebView2 probe diagnostic rather than throwing", async () => {
    const evidence = await probeWebView2DebugEndpoints(
      9222,
      vi.fn().mockRejectedValue(new Error("connection refused")),
    );

    expect(evidence.reachable).toBe(false);
    expect(evidence.attempts).toHaveLength(3);
    expect(evidence.attempts[0]).toMatchObject({
      ok: false,
      error: "Error: connection refused",
    });
  });
});
