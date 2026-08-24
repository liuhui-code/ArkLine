import {
  rendererInteractionStart,
  waitForActiveTab,
  waitForEditorTarget,
  waitForSearchEverywhereClass,
  waitForSearchResult,
} from "./packaged-soak-readiness.mjs";
import {
  SEARCH_UI_EVIDENCE_SCRIPT,
  shouldRecordSearchEvidence,
} from "./packaged-soak-search-evidence.mjs";
import {
  findQueryForCycle,
  quickOpenTargetForCycle,
} from "./packaged-soak-scenario.mjs";
import { WEBDRIVER_KEYS } from "./packaged-soak-webdriver.mjs";

export async function verifySearchEverywhereClass(driver, className) {
  await driver.keyChord([WEBDRIVER_KEYS.shift]);
  await driver.keyChord([WEBDRIVER_KEYS.shift]);
  await driver.waitForSelectorPresent('[aria-label="Search Everywhere Query"]');
  await driver.typeText(className);
  await waitForSearchEverywhereClass(driver, className, 8_000);
  await driver.keyChord([WEBDRIVER_KEYS.escape]);
}

export async function exerciseFindInFiles(
  driver,
  cycle,
  automationDispatchSamples,
  readySamples,
  counters,
  searchEvidence,
  scenario,
) {
  await driver.keyChord([
    WEBDRIVER_KEYS.control,
    WEBDRIVER_KEYS.shift,
    "f",
  ]);
  await driver.waitForSelectorPresent('[aria-label="Find in Files Query"]');
  const query = findQueryForCycle(scenario, cycle);
  automationDispatchSamples.push(await timed(() => driver.typeText(query)));
  const searchStarted = await rendererInteractionStart(
    driver,
    "input:Find in Files Query",
  );
  if (cycle === 0) {
    await captureSearchEvidence(
      driver,
      "find-typed",
      "Find in Files Query",
      "Find in Files Results",
      searchEvidence,
    );
  }
  const ready = await waitForSearchResult(
    driver,
    "Find in Files Results",
    query,
    5_000,
  ).catch(() => null);
  if (ready) {
    readySamples.push(Math.max(0, ready.at - searchStarted));
    await captureSearchEvidence(
      driver,
      "find-ready",
      "Find in Files Query",
      "Find in Files Results",
      searchEvidence,
    );
    await driver.typeText(WEBDRIVER_KEYS.arrowDown);
  } else {
    counters.searchMissCount += 1;
    counters.findInFilesMissCount += 1;
    await captureSearchEvidence(
      driver,
      "find-miss",
      "Find in Files Query",
      "Find in Files Results",
      searchEvidence,
    );
  }
  automationDispatchSamples.push(await timed(
    () => driver.typeText(WEBDRIVER_KEYS.backspace.repeat(query.length)),
  ));
  await waitForQueryState(driver, "Find in Files Query", "", 2_000);
  await driver.keyChord([WEBDRIVER_KEYS.escape]);
  await waitForQueryAbsent(driver, "Find in Files Query", 2_000);
}

export async function exerciseQuickOpen(
  driver,
  cycle,
  jumpSamples,
  counters,
  searchEvidence,
  scenario,
) {
  const target = quickOpenTargetForCycle(scenario, cycle);
  return openQuickOpenTarget(
    driver,
    target,
    jumpSamples,
    counters,
    searchEvidence,
  );
}

export async function openQuickOpenTarget(
  driver,
  target,
  jumpSamples,
  counters,
  searchEvidence,
) {
  await driver.keyChord([WEBDRIVER_KEYS.control, "p"]);
  await driver.waitForSelectorPresent('[aria-label="Quick Open Query"]');
  await driver.typeText(target.query);
  await captureSearchEvidence(
    driver,
    "quick-open-typed",
    "Quick Open Query",
    "Quick Open Results",
    searchEvidence,
  );
  const ready = await waitForSearchResult(
    driver,
    "Quick Open Results",
    target.query,
    8_000,
  ).catch(() => null);
  if (!ready) {
    counters.searchMissCount += 1;
    counters.quickOpenMissCount += 1;
    await captureSearchEvidence(
      driver,
      "quick-open-miss",
      "Quick Open Query",
      "Quick Open Results",
      searchEvidence,
    );
    await driver.keyChord([WEBDRIVER_KEYS.escape]);
    return false;
  }
  await captureSearchEvidence(
    driver,
    "quick-open-ready",
    "Quick Open Query",
    "Quick Open Results",
    searchEvidence,
  );
  await driver.keyChord([WEBDRIVER_KEYS.enter]);
  const started = await rendererInteractionStart(driver, "enter:Quick Open Query");
  try {
    await waitForActiveTab(driver, target.title, 10_000);
    const editorTarget = await waitForEditorTarget(
      driver,
      target.editorNeedle,
      10_000,
    );
    jumpSamples.push(Math.max(0, editorTarget.at - started));
    const activeTab = await waitForActiveTab(driver, target.title, 1_000);
    if (!activeTab.title.includes(target.title)) counters.staleApplyCount += 1;
  } catch (error) {
    counters.staleApplyCount += 1;
    await captureSearchEvidence(
      driver,
      "quick-open-enter-failed",
      "Quick Open Query",
      "Quick Open Results",
      searchEvidence,
    );
    throw error;
  }
  return true;
}

async function captureSearchEvidence(
  driver,
  phase,
  queryLabel,
  resultsLabel,
  evidenceItems,
) {
  const evidence = await driver.execute(
    SEARCH_UI_EVIDENCE_SCRIPT,
    [phase, queryLabel, resultsLabel],
  ).catch((error) => ({
    capturedAt: Date.now(),
    phase,
    error: String(error),
    resultCount: 0,
  }));
  if (shouldRecordSearchEvidence(evidence, evidenceItems.length)) {
    evidenceItems.push(evidence);
  }
}

async function timed(operation) {
  const started = performance.now();
  await operation();
  return performance.now() - started;
}

async function waitForQueryState(driver, label, expectedValue, timeoutMs) {
  await pollUntil(async () => {
    const value = await driver.execute(QUERY_VALUE_SCRIPT, [label]);
    return value === expectedValue;
  }, timeoutMs, `${label} did not reach ${JSON.stringify(expectedValue)}`);
}

async function waitForQueryAbsent(driver, label, timeoutMs) {
  await pollUntil(async () => {
    const value = await driver.execute(QUERY_VALUE_SCRIPT, [label]);
    return value === null;
  }, timeoutMs, `${label} did not close`);
}

async function pollUntil(operation, timeoutMs, timeoutMessage) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await operation()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(timeoutMessage);
}

export const QUERY_VALUE_SCRIPT = `
  const input = document.querySelector('[aria-label="' + arguments[0] + '"]');
  return input && "value" in input ? input.value : null;
`;
