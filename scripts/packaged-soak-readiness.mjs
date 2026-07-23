import {
  DIAGNOSTICS_SCRIPT,
  INTERACTION_START_SCRIPT,
  UI_READINESS_SCRIPT,
} from "./packaged-soak-telemetry.mjs";

export async function waitForWorkspace(driver, fixturePath, timeoutMs) {
  const expectedName = fixturePath.split(/[\\/]/).filter(Boolean).at(-1);
  await pollUntil(async () => {
    const text = await driver.text('[aria-label="Status Bar Left"]').catch(() => "");
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

export async function waitForFullIndexReady(driver, rootPath, timeoutMs) {
  return waitForIndexState(
    driver,
    rootPath,
    timeoutMs,
    (value) => (
      value.status === "ready"
      && value.fileCount > 0
      && value.contentLineCount > 0
      && value.discoveredFileCount > 0
      && indexedLayerCount(value, "content") >= value.fileCount
    ),
    "Workspace index did not become ready",
  );
}

function indexedLayerCount(value, layerName) {
  return value.layerReadiness?.layers?.find(
    (layer) => layer.layer === layerName,
  )?.indexedCount ?? 0;
}

export async function waitForSearchResult(
  driver,
  resultsLabel,
  expectedQuery,
  timeoutMs,
) {
  return pollUntil(async () => {
    const snapshot = await driver.execute(UI_READINESS_SCRIPT, [resultsLabel]);
    return snapshot?.query === expectedQuery && snapshot.count > 0
      ? snapshot
      : null;
  }, timeoutMs, `${resultsLabel} did not render results`);
}

export async function waitForActiveTab(driver, pageName, timeoutMs) {
  return pollUntil(async () => {
    const snapshot = await driver.execute(UI_READINESS_SCRIPT, ["activeTab"]);
    return snapshot?.title?.includes(pageName) ? snapshot : null;
  }, timeoutMs, `Quick Open did not activate ${pageName}`);
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
) {
  let latest = null;
  await pollUntil(async () => {
    const response = await driver.executeAsync(DIAGNOSTICS_SCRIPT, [rootPath]);
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
