import {
  waitForCoreIndexReady,
  waitForDiscoveryReady,
  waitForTerminalIndexReady,
} from "./packaged-soak-readiness.mjs";
import { warmSemanticInteractions } from "./packaged-soak-semantic-workload.mjs";
import { verifySearchEverywhereClass } from "./packaged-soak-search-workload.mjs";

export async function preparePackagedSoakRun(
  driver,
  options,
  scenario,
  onPhase,
) {
  if (options.mode === "smoke" && scenario.kind === "generated") {
    onPhase("discovery-ready");
    await waitForDiscoveryReady(
      driver,
      options.fixturePath,
      90_000,
    );
    onPhase("search-everywhere-class-ready");
    await verifySearchEverywhereClass(driver, "Page000000");
  } else {
    onPhase("discovery-ready");
    await waitForDiscoveryReady(driver, options.fixturePath, 180_000);
  }
  if (scenario.kind === "real-workspace") {
    onPhase("core-index-ready");
    await waitForCoreIndexReady(
      driver,
      options.fixturePath,
      options.coreIndexTimeoutMs,
    );
    onPhase("search-everywhere-class-ready");
    await verifySearchEverywhereClass(driver, scenario.searchEverywhereClass);
  }
  onPhase("semantic-warmup");
  await warmSemanticInteractions(driver, scenario, {
    definitionMissCount: 0,
    completionMissCount: 0,
  }, []);
  if (scenario.kind === "real-workspace") {
    onPhase("terminal-index-ready");
    await waitForTerminalIndexReady(
      driver,
      options.fixturePath,
      options.coreIndexTimeoutMs,
    );
  }
}
