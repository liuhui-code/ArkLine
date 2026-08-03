import {
  DIAGNOSTICS_SCRIPT,
  INTERACTION_START_SCRIPT,
  UI_READINESS_SCRIPT,
} from "./packaged-soak-telemetry.mjs";

export async function waitForWorkspace(driver, fixturePath, timeoutMs) {
  const expectedName = fixturePath.split(/[\\/]/).filter(Boolean).at(-1);
  await pollUntil(async () => {
    const text = await driver.execute(
      `return document.querySelector(arguments[0])?.innerText || "";`,
      ['[aria-label="Status Bar Left"]'],
    ).catch(() => "");
    return text.includes(expectedName);
  }, timeoutMs, `Workspace did not open: ${expectedName}`);
}

export async function waitForDiscoveryReady(driver, rootPath, timeoutMs) {
  return waitForIndexState(
    driver,
    rootPath,
    timeoutMs,
    (value) => (
      value.discoveryStatus === "ready"
      && value.discoveredFileCount > 0
      && value.fileCount >= value.discoveredFileCount
    ),
    "Workspace discovery did not become ready",
  );
}

export async function waitForCoreIndexReady(driver, rootPath, timeoutMs) {
  return waitForIndexState(
    driver,
    rootPath,
    timeoutMs,
    isCoreWorkspaceIndexReady,
    "Workspace index did not become ready",
  );
}

export async function waitForInteractiveIndexReady(
  driver,
  rootPath,
  currentFilePath,
  timeoutMs,
) {
  return waitForIndexState(
    driver,
    rootPath,
    timeoutMs,
    isInteractiveWorkspaceIndexReady,
    "Workspace interactive index did not become ready",
    currentFilePath,
  );
}

export function isInteractiveWorkspaceIndexReady(value) {
  const contentReadiness = value.layerReadiness?.layers?.find(
    (layer) => layer.layer === "content",
  );
  return value.discoveryStatus === "ready"
    && value.discoveredFileCount > 0
    && value.fileCount >= value.discoveredFileCount
    && contentReadiness?.indexedCount > 0
    && contentReadiness?.currentFileStatus === "ready";
}

export function isCoreWorkspaceIndexReady(value) {
  const contentFreshness = value.freshnessLayers?.find(
    (layer) => layer.layer === "content",
  );
  const contentReadiness = value.layerReadiness?.layers?.find(
    (layer) => layer.layer === "content",
  );
  return value.discoveryStatus === "ready"
    && value.discoveredFileCount > 0
    && value.fileCount >= value.discoveredFileCount
    && value.contentLineCount > 0
    && contentFreshness?.missingCount === 0
    && contentFreshness?.staleCount === 0
    && contentFreshness?.readyCount >= value.fileCount
    && contentReadiness?.indexedCount >= value.fileCount;
}

export async function waitForSearchResult(
  driver,
  resultsLabel,
  expectedQuery,
  timeoutMs,
) {
  const snapshot = await driver.executeAsync(
    SEARCH_RESULT_READINESS_SCRIPT,
    [resultsLabel, expectedQuery, timeoutMs],
    timeoutMs + 1_000,
  );
  if (snapshot) return snapshot;
  throw new Error(`${resultsLabel} did not render results`);
}

export async function waitForActiveTab(driver, pageName, timeoutMs) {
  return pollUntil(async () => {
    const snapshot = await driver.execute(UI_READINESS_SCRIPT, ["activeTab"]);
    return snapshot?.title?.includes(pageName) ? snapshot : null;
  }, timeoutMs, `Quick Open did not activate ${pageName}`);
}

export async function waitForEditorTarget(driver, expectedNeedle, timeoutMs) {
  const snapshot = await driver.executeAsync(
    EDITOR_TARGET_READINESS_SCRIPT,
    [expectedNeedle, timeoutMs],
    timeoutMs + 1_000,
  );
  if (snapshot?.matched) return snapshot;
  throw new Error(
    `Editor did not render target ${expectedNeedle}: ${JSON.stringify(snapshot)}`,
  );
}

export async function rendererInteractionStart(driver, key) {
  const startedAt = await driver.execute(INTERACTION_START_SCRIPT, [key]);
  if (!Number.isFinite(startedAt)) {
    throw new Error(`Renderer interaction start was not captured: ${key}`);
  }
  return startedAt;
}

async function waitForIndexState(
  driver,
  rootPath,
  timeoutMs,
  isReady,
  timeoutMessage,
  currentFilePath = null,
) {
  let latest = null;
  await pollUntil(async () => {
    const response = await driver.executeAsync(
      DIAGNOSTICS_SCRIPT,
      [rootPath, currentFilePath],
    );
    latest = response?.ok ? response.value : response;
    return response?.ok && isReady(response.value);
  }, timeoutMs, () => `${timeoutMessage}: ${JSON.stringify(latest)}`);
  return latest;
}

async function pollUntil(operation, timeoutMs, timeoutMessage) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await operation();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    typeof timeoutMessage === "function" ? timeoutMessage() : timeoutMessage,
  );
}

export const SEARCH_RESULT_READINESS_SCRIPT = `
  const label = arguments[0];
  const expectedQuery = arguments[1];
  const timeoutMs = arguments[2];
  const done = arguments[arguments.length - 1];
  const selectors = {
    "Find in Files Results": {
      results: '[aria-label="Find in Files Results"]',
      query: '[aria-label="Find in Files Query"]'
    },
    "Quick Open Results": {
      results: '[aria-label="Quick Open Results"]',
      query: '[aria-label="Quick Open Query"]'
    }
  };
  const selector = selectors[label];
  let observer;
  let timer;
  let finished = false;
  const finish = (value) => {
    if (finished) return;
    finished = true;
    observer?.disconnect();
    clearTimeout(timer);
    done(value);
  };
  const inspect = () => {
    if (!selector) return finish(null);
    const results = document.querySelector(selector.results);
    const query = document.querySelector(selector.query)?.value || "";
    const buttons = [...(results?.querySelectorAll("button") || [])];
    const count = buttons.length;
    const expectedResultReady = label !== "Quick Open Results"
      || (
        results?.dataset.query === expectedQuery
        && buttons.some((button) => (button.innerText || "").includes(expectedQuery))
      );
    if (query === expectedQuery && count > 0 && expectedResultReady) {
      finish({ at: performance.now(), count, query });
    }
  };
  inspect();
  if (!finished) {
    observer = new MutationObserver(inspect);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    timer = setTimeout(() => finish(null), timeoutMs);
  }
`;

export const EDITOR_TARGET_READINESS_SCRIPT = `
  const expectedNeedle = arguments[0];
  const timeoutMs = arguments[1];
  const done = arguments[arguments.length - 1];
  let observer;
  let timer;
  let finished = false;
  const finish = (value) => {
    if (finished) return;
    finished = true;
    observer?.disconnect();
    clearTimeout(timer);
    done(value);
  };
  const inspect = () => {
    const bodyText = document.body?.innerText || "";
    const crashed = bodyText.includes("ArkLine hit a UI error")
      || bodyText.includes("Editor crash")
      || bodyText.includes("Restart the app window");
    if (crashed) {
      finish({ matched: false, crashed: true, at: performance.now() });
      return;
    }
    const editor = document.querySelector('[aria-label="Editor Content"]');
    const text = editor?.textContent || "";
    if (editor && text.includes(expectedNeedle)) {
      finish({ matched: true, crashed: false, at: performance.now() });
    }
  };
  observer = new MutationObserver(inspect);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  timer = setTimeout(() => {
    const editor = document.querySelector('[aria-label="Editor Content"]');
    finish({
      matched: false,
      crashed: false,
      editorPresent: Boolean(editor),
      preview: (editor?.textContent || "").slice(0, 160),
      at: performance.now()
    });
  }, timeoutMs);
  inspect();
`;
