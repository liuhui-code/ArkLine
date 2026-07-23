import { execFile, spawn } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function buildWebView2Environment(baseEnvironment, fixturePath, debugPort) {
  const remoteDebugging = `--remote-debugging-port=${debugPort}`;
  const existing = baseEnvironment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS?.trim();
  return {
    ...baseEnvironment,
    ARKLINE_WORKSPACE_ROOT: fixturePath,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: existing
      ? `${existing} ${remoteDebugging}`
      : remoteDebugging,
  };
}

export function nativeDriverArguments(port) {
  return [`--port=${port}`, "--verbose"];
}

export class WindowsPackagedAutomationSession {
  constructor(options) {
    this.options = options;
    this.applicationProcess = null;
    this.applicationExitPromise = null;
    this.applicationExit = null;
    this.applicationLog = "";
    this.driverProcess = null;
    this.driverExitPromise = null;
    this.driverExit = null;
    this.driverLog = "";
    this.debugPort = null;
    this.driverPort = null;
  }

  async startApplication() {
    this.debugPort = await findAvailablePort();
    this.applicationProcess = spawn(this.options.applicationPath, [], {
      env: buildWebView2Environment(
        process.env,
        this.options.fixturePath,
        this.debugPort,
      ),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.applicationExitPromise = observeProcessExit(this.applicationProcess);
    captureProcessLog(this.applicationProcess, (chunk) => {
      this.applicationLog = appendBoundedLog(this.applicationLog, chunk);
    });
  }

  async waitForWebView2(timeoutMs = 60_000) {
    const endpoint = `http://127.0.0.1:${this.debugPort}/json/version`;
    await pollWithProcessExit(
      async () => {
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(2_000) });
        if (!response.ok) return false;
        const value = await response.json();
        return Boolean(value?.webSocketDebuggerUrl);
      },
      this.applicationExitPromise,
      timeoutMs,
      "WebView2 remote debugging endpoint did not become ready",
    );
  }

  async startDriver() {
    this.driverPort = await findAvailablePort(new Set([this.debugPort]));
    this.driverProcess = spawn(
      this.options.driverPath,
      nativeDriverArguments(this.driverPort),
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.driverExitPromise = observeProcessExit(this.driverProcess);
    captureProcessLog(this.driverProcess, (chunk) => {
      this.driverLog = appendBoundedLog(this.driverLog, chunk);
    });
  }

  async waitForDriver(driver, timeoutMs = 30_000) {
    await pollWithProcessExit(
      () => driver.request("/status").then(() => true, () => false),
      this.driverExitPromise,
      timeoutMs,
      "msedgedriver did not become ready",
    );
  }

  debuggerAddress() {
    return `127.0.0.1:${this.debugPort}`;
  }

  driverBaseUrl() {
    return `http://127.0.0.1:${this.driverPort}`;
  }

  async stop() {
    this.driverExit = await stopWindowsProcess(
      this.driverProcess,
      this.driverExitPromise,
    );
    this.applicationExit = await stopWindowsProcess(
      this.applicationProcess,
      this.applicationExitPromise,
    );
  }

  evidence() {
    return {
      mode: "webview2-attach",
      debugPort: this.debugPort,
      driverPort: this.driverPort,
      application: {
        pid: this.applicationProcess?.pid ?? null,
        exit: this.applicationExit,
        log: this.applicationLog,
      },
      driver: {
        pid: this.driverProcess?.pid ?? null,
        exit: this.driverExit,
        log: this.driverLog,
      },
    };
  }
}

async function pollWithProcessExit(
  operation,
  exitPromise,
  timeoutMs,
  timeoutMessage,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const outcome = await Promise.race([
      Promise.resolve(operation()).then(
        (ready) => ({ ready }),
        (error) => ({ ready: false, error }),
      ),
      exitPromise.then((exit) => ({ exit })),
    ]);
    if (outcome.exit) {
      throw new Error(`Process exited before ready: ${JSON.stringify(outcome.exit)}`);
    }
    if (outcome.ready) return;
    await sleep(100);
  }
  throw new Error(timeoutMessage);
}

function observeProcessExit(child) {
  return new Promise((resolve) => {
    child.once("error", (error) => {
      resolve({ error: String(error), capturedAt: Date.now() });
    });
    child.once("exit", (code, signal) => {
      resolve({ code, signal, capturedAt: Date.now() });
    });
  });
}

function captureProcessLog(child, onChunk) {
  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);
}

async function stopWindowsProcess(child, exitPromise) {
  if (!child || !exitPromise) return null;
  if (child.exitCode === null && child.pid) {
    await execFileAsync(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, timeout: 5_000 },
    ).catch(() => child.kill());
  }
  return Promise.race([
    exitPromise,
    sleep(5_000).then(() => ({ timedOut: true, capturedAt: Date.now() })),
  ]);
}

function findAvailablePort(excluded = new Set()) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!port || excluded.has(port)) resolve(findAvailablePort(excluded));
        else resolve(port);
      });
    });
  });
}

function appendBoundedLog(current, chunk, limit = 100_000) {
  return `${current}${String(chunk)}`.slice(-limit);
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
