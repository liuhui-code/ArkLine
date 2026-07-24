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
import {
  SEARCH_RESULT_READINESS_SCRIPT,
  waitForSearchResult,
} from "../../scripts/packaged-soak-readiness.mjs";

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

  it("sends special keys through W3C keyboard actions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: null }),
    });
    const driver = new PackagedWebDriver(
      "http://127.0.0.1:4445",
      fetchImpl,
    );
    driver.sessionId = "session-1";

    await driver.keyChord(["\uE007"]);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:4445/session/session-1/actions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          actions: [{
            type: "key",
            id: "arkline-keyboard",
            actions: [
              { type: "keyDown", value: "\uE007" },
              { type: "keyUp", value: "\uE007" },
            ],
          }],
        }),
      }),
    );
  });

  it("types through W3C actions without retaining active element references", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: null }),
    });
    const driver = new PackagedWebDriver(
      "http://127.0.0.1:4445",
      fetchImpl,
    );
    driver.sessionId = "session-1";

    await driver.typeText("ab\uE003");

    const firstRequest = fetchImpl.mock.calls[0];
    expect(firstRequest?.[0]).toBe(
      "http://127.0.0.1:4445/session/session-1/actions",
    );
    expect(JSON.parse(firstRequest?.[1]?.body as string)).toEqual({
      actions: [{
        type: "key",
        id: "arkline-keyboard",
        actions: [
          { type: "keyDown", value: "a" },
          { type: "keyUp", value: "a" },
          { type: "keyDown", value: "b" },
          { type: "keyUp", value: "b" },
          { type: "keyDown", value: "\uE003" },
          { type: "keyUp", value: "\uE003" },
        ],
      }],
    });
    expect(fetchImpl.mock.calls.every(([url]) => !String(url).includes("/element"))).toBe(true);
  });

  it("reads hot-loop DOM state without creating WebDriver element ids", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: "ArkLine ready" }),
      });
    const driver = new PackagedWebDriver(
      "http://127.0.0.1:4445",
      fetchImpl,
    );
    driver.sessionId = "session-1";

    await expect(driver.waitForSelectorPresent(".ready")).resolves.toBeUndefined();
    await expect(driver.pageText()).resolves.toBe("ArkLine ready");

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:4445/session/session-1/execute/sync",
      "http://127.0.0.1:4445/session/session-1/execute/sync",
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

  it("measures search readiness from DOM mutation rather than polling", async () => {
    const driver = {
      executeAsync: vi.fn().mockResolvedValue({
        at: 120,
        count: 2,
        query: "needle",
      }),
    };

    await expect(waitForSearchResult(
      driver,
      "Find in Files Results",
      "needle",
      5_000,
    )).resolves.toMatchObject({ at: 120, count: 2 });
    expect(driver.executeAsync).toHaveBeenCalledWith(
      SEARCH_RESULT_READINESS_SCRIPT,
      ["Find in Files Results", "needle", 5_000],
      6_000,
    );
    expect(SEARCH_RESULT_READINESS_SCRIPT).toContain("MutationObserver");
  });

  it("does not treat stale Quick Open rows as the current query result", async () => {
    const driver = {
      executeAsync: vi.fn().mockResolvedValue({
        at: 140,
        count: 1,
        query: "Page000097",
      }),
    };

    await waitForSearchResult(
      driver,
      "Quick Open Results",
      "Page000097",
      8_000,
    );

    expect(driver.executeAsync).toHaveBeenCalledWith(
      SEARCH_RESULT_READINESS_SCRIPT,
      ["Quick Open Results", "Page000097", 8_000],
      9_000,
    );
    expect(SEARCH_RESULT_READINESS_SCRIPT).toContain("expectedResultReady");
    expect(SEARCH_RESULT_READINESS_SCRIPT).toContain("results?.dataset.query");
    expect(SEARCH_RESULT_READINESS_SCRIPT).toContain("button.innerText");
  });
});
