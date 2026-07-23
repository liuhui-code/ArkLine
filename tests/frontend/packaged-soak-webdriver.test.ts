import { describe, expect, it, vi } from "vitest";
import {
  buildAttachedCapabilities,
  PackagedWebDriver,
} from "../../scripts/packaged-soak-webdriver.mjs";
import {
  buildWebView2Environment,
  nativeDriverArguments,
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

  it("preserves existing WebView2 flags and adds the debug endpoint", () => {
    expect(buildWebView2Environment(
      { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--disable-gpu" },
      "C:\\fixture",
      9222,
    )).toMatchObject({
      ARKLINE_WORKSPACE_ROOT: "C:\\fixture",
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--disable-gpu --remote-debugging-port=9222",
    });
    expect(nativeDriverArguments(4445)).toEqual([
      "--port=4445",
      "--verbose",
    ]);
  });
});
