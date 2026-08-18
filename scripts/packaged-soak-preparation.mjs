import {
  waitForCoreIndexReady,
  waitForDiscoveryReady,
  waitForInteractiveIndexReady,
  waitForTerminalIndexReady,
} from "./packaged-soak-readiness.mjs";
import { warmSemanticInteractions } from "./packaged-soak-semantic-workload.mjs";
import { buildFixtureRelativePath } from "./generate-performance-fixture.mjs";
import path from "node:path";

export async function preparePackagedSoakRun(
  driver,
  options,
  scenario,
  onPhase,
) {
  if (options.mode === "smoke" && scenario.kind === "generated") {
    onPhase("interactive-index-ready");
    await waitForInteractiveIndexReady(
      driver,
      options.fixturePath,
      path.join(options.fixturePath, buildFixtureRelativePath(0)),
      90_000,
    );
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
