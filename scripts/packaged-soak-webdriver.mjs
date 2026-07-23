const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

export const WEBDRIVER_KEYS = Object.freeze({
  backspace: "\uE003",
  enter: "\uE007",
  shift: "\uE008",
  control: "\uE009",
  escape: "\uE00C",
  arrowUp: "\uE013",
  arrowDown: "\uE015",
});

export function buildAttachedCapabilities(debuggerAddress) {
  return {
    capabilities: {
      alwaysMatch: {
        browserName: "webview2",
        "ms:edgeChromium": true,
        "ms:edgeOptions": { debuggerAddress },
      },
      firstMatch: [{}],
    },
  };
}

export class PackagedWebDriver {
  constructor(baseUrl = "http://127.0.0.1:4444", fetchImpl = fetch) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.sessionId = null;
    this.capabilities = {};
  }

  async waitUntilReady(timeoutMs = 30_000) {
    await pollUntil(async () => {
      try {
        await this.request("/status");
        return true;
      } catch {
        return false;
      }
    }, timeoutMs, "tauri-driver did not become ready");
  }

  async createSession(applicationPath) {
    const value = await this.request("/session", {
      method: "POST",
      body: {
        capabilities: {
          alwaysMatch: {
            browserName: "wry",
            "tauri:options": { application: applicationPath },
          },
        },
      },
      timeoutMs: 60_000,
    });
    this.sessionId = value.sessionId;
    this.capabilities = value.capabilities ?? {};
    if (!this.sessionId) throw new Error("tauri-driver returned no session id");
  }

  async createAttachedSession(debuggerAddress) {
    const value = await this.request("/session", {
      method: "POST",
      body: buildAttachedCapabilities(debuggerAddress),
      timeoutMs: 60_000,
    });
    this.sessionId = value.sessionId;
    this.capabilities = value.capabilities ?? {};
    if (!this.sessionId) throw new Error("msedgedriver returned no session id");
  }

  async close() {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    this.sessionId = null;
    await this.request(`/session/${sessionId}`, {
      method: "DELETE",
      timeoutMs: 10_000,
    }).catch(() => undefined);
  }

  async waitForSelector(selector, timeoutMs = 15_000) {
    return pollUntil(
      () => this.findElement(selector).catch(() => null),
      timeoutMs,
      `Timed out waiting for ${selector}`,
    );
  }

  async findElement(selector) {
    const value = await this.sessionRequest("/element", {
      method: "POST",
      body: { using: "css selector", value: selector },
    });
    const elementId = value[ELEMENT_KEY];
    if (!elementId) throw new Error(`No element id for ${selector}`);
    return elementId;
  }

  async exists(selector) {
    return this.findElement(selector).then(() => true, () => false);
  }

  async text(selector) {
    const elementId = await this.findElement(selector);
    return this.sessionRequest(`/element/${elementId}/text`);
  }

  async pageText() {
    return this.text("body");
  }

  async activeElement() {
    const value = await this.sessionRequest("/element/active");
    const elementId = value[ELEMENT_KEY];
    if (!elementId) throw new Error("No active element");
    return elementId;
  }

  async sendKeys(elementId, text) {
    return this.sessionRequest(`/element/${elementId}/value`, {
      method: "POST",
      body: { text, value: Array.from(text) },
    });
  }

  async sendToActive(text) {
    return this.sendKeys(await this.activeElement(), text);
  }

  async keyChord(keys) {
    const keyActions = [];
    keys.forEach((key) => keyActions.push({ type: "keyDown", value: key }));
    [...keys].reverse().forEach((key) => keyActions.push({ type: "keyUp", value: key }));
    await this.sessionRequest("/actions", {
      method: "POST",
      body: {
        actions: [{ type: "key", id: "arkline-keyboard", actions: keyActions }],
      },
    });
    await this.sessionRequest("/actions", { method: "DELETE" }).catch(() => undefined);
  }

  async execute(script, args = []) {
    return this.sessionRequest("/execute/sync", {
      method: "POST",
      body: { script, args },
    });
  }

  async executeAsync(script, args = [], timeoutMs = 15_000) {
    return this.sessionRequest("/execute/async", {
      method: "POST",
      body: { script, args },
      timeoutMs,
    });
  }

  async sessionRequest(pathname, options = {}) {
    if (!this.sessionId) throw new Error("WebDriver session is not open");
    return this.request(`/session/${this.sessionId}${pathname}`, options);
  }

  async request(pathname, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 15_000,
    );
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method: options.method ?? "GET",
        headers: options.body ? { "content-type": "application/json" } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.value?.error) {
        const detail = payload.value?.message ?? response.statusText;
        throw new Error(`WebDriver ${response.status}: ${detail}`);
      }
      return payload.value;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function pollUntil(operation, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(lastError ? `${message}: ${lastError}` : message);
}
