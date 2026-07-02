import type { ChangeEvent } from "react";
import { buildConfigurationMatchesState } from "@/features/build/build-configuration";
import type { BuildState, BuildTarget } from "@/features/build/build-model";
import { buildPipelineStatusLabel, deriveBuildPipelineSteps } from "@/features/build/build-pipeline";

type BuildToolWindowProps = {
  state: BuildState;
  workspaceRootPath: string | null;
  modules: string[];
  onChangeTarget: (target: BuildTarget) => void;
  onChangeModuleName: (moduleName: string) => void;
  onChangeProduct: (product: string) => void;
  onChangeBuildMode: (buildMode: "debug" | "release") => void;
  onChangeFastMode: (fastMode: boolean) => void;
  onSelectConfiguration: (configurationId: string) => void;
  onSaveConfiguration: () => void;
  onCopyConfiguration: () => void;
  onDeleteConfiguration: () => void;
  onRunBuild: () => void;
  onRunCleanBuild: () => void;
  onStopBuild: () => void;
};

function formatDuration(durationMs: number | null) {
  if (durationMs === null) {
    return "";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

export function BuildToolWindow({
  state,
  workspaceRootPath,
  modules,
  onChangeTarget,
  onChangeModuleName,
  onChangeProduct,
  onChangeBuildMode,
  onChangeFastMode,
  onSelectConfiguration,
  onSaveConfiguration,
  onCopyConfiguration,
  onDeleteConfiguration,
  onRunBuild,
  onRunCleanBuild,
  onStopBuild,
}: BuildToolWindowProps) {
  const running = state.status === "running";
  const hasWorkspace = Boolean(workspaceRootPath);
  const duration = formatDuration(state.lastDurationMs);
  const moduleOptions = modules.length > 0 ? modules : [state.moduleName || "entry"];
  const productOptions = state.products.length > 0 ? state.products : [state.product || "default"];
  const activeConfiguration = state.configurations.find((configuration) => configuration.id === state.activeConfigurationId) ?? null;
  const configurationModified = activeConfiguration ? !buildConfigurationMatchesState(activeConfiguration, state) : false;
  const pipelineSteps = deriveBuildPipelineSteps(state);

  function changeTarget(event: ChangeEvent<HTMLSelectElement>) {
    onChangeTarget(event.target.value as BuildTarget);
  }

  function changeBuildMode(event: ChangeEvent<HTMLSelectElement>) {
    onChangeBuildMode(event.target.value as "debug" | "release");
  }

  return (
    <section aria-label="Build Panel" className="build-tool-window">
      <div className="build-tool-window__toolbar">
        <label className="build-tool-window__field build-tool-window__field--configuration">
          <span>Configuration</span>
          <select aria-label="Build Configuration" value={state.activeConfigurationId ?? ""} disabled={running} onChange={(event) => onSelectConfiguration(event.target.value)}>
            <option value="">Current settings</option>
            {state.configurations.map((configuration) => (
              <option key={configuration.id} value={configuration.id}>{configuration.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="build-tool-window__button" disabled={!hasWorkspace || running} onClick={onSaveConfiguration}>
          Save Config
        </button>
        <button type="button" className="build-tool-window__button" disabled={!activeConfiguration || running} onClick={onCopyConfiguration}>
          Copy Config
        </button>
        <button type="button" className="build-tool-window__button" disabled={!activeConfiguration || running} onClick={onDeleteConfiguration}>
          Delete Config
        </button>
        {configurationModified ? <span className="build-tool-window__badge">Modified</span> : null}
        <button type="button" aria-label="Run Build Configuration" className="build-tool-window__button build-tool-window__button--primary" disabled={!hasWorkspace || running} onClick={onRunBuild}>
          Run
        </button>
        <button type="button" className="build-tool-window__button" disabled={!hasWorkspace || running} onClick={onRunCleanBuild}>
          Clean Build
        </button>
        <button type="button" className="build-tool-window__button" aria-label="Stop Build" disabled={!running} onClick={onStopBuild}>
          Stop
        </button>
        <label className="build-tool-window__field">
          <span>Target</span>
          <select value={state.lastTarget} disabled={running} onChange={changeTarget}>
            <option value="hap">HAP</option>
            <option value="app">APP</option>
            <option value="har">HAR</option>
            <option value="hsp">HSP</option>
          </select>
        </label>
        <label className="build-tool-window__field">
          <span>Module</span>
          <select aria-label="Build Module" value={state.moduleName} disabled={running || state.lastTarget === "app"} onChange={(event) => onChangeModuleName(event.target.value)}>
            {moduleOptions.map((moduleName) => (
              <option key={moduleName} value={moduleName}>{moduleName}</option>
            ))}
          </select>
        </label>
        <label className="build-tool-window__field">
          <span>Product</span>
          <select aria-label="Build Product" value={state.product} disabled={running} onChange={(event) => onChangeProduct(event.target.value)}>
            {productOptions.map((product) => (
              <option key={product} value={product}>{product}</option>
            ))}
          </select>
        </label>
        <label className="build-tool-window__field">
          <span>Mode</span>
          <select aria-label="Build Mode" value={state.buildMode} disabled={running} onChange={changeBuildMode}>
            <option value="debug">Debug</option>
            <option value="release">Release</option>
          </select>
        </label>
        <label className="build-tool-window__toggle">
          <input type="checkbox" checked={state.fastMode} disabled={running} onChange={(event) => onChangeFastMode(event.target.checked)} />
          <span>Fast mode</span>
        </label>
      </div>
      <div className="build-tool-window__summary">
        <strong>{state.message}</strong>
        {duration ? <span>{duration}</span> : null}
        {state.currentRun ? <code>{state.currentRun.command}</code> : null}
      </div>
      {pipelineSteps.length > 0 ? (
        <ol className="build-tool-window__pipeline" aria-label="Build Pipeline">
          {pipelineSteps.map((step) => (
            <li key={step.id} className={`build-tool-window__pipeline-step build-tool-window__pipeline-step--${step.status}`}>
              <span>{step.label}</span>
              <strong>{buildPipelineStatusLabel(step.status)}</strong>
            </li>
          ))}
        </ol>
      ) : null}
      {state.preflight?.issues.length ? (
        <ul className="build-tool-window__preflight" aria-label="Build Preflight Issues">
          {state.preflight.issues.map((issue) => (
            <li key={issue.code} className={`build-tool-window__preflight-item build-tool-window__preflight-item--${issue.severity}`}>
              <strong>{issue.message}</strong>
              <span>{issue.hint}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <pre className="build-tool-window__output">{state.output || "Build output will appear here."}</pre>
    </section>
  );
}
