import type { ChangeEvent } from "react";
import type { BuildState, BuildTarget } from "@/features/build/build-model";

type BuildToolWindowProps = {
  state: BuildState;
  workspaceRootPath: string | null;
  onChangeTarget: (target: BuildTarget) => void;
  onChangeModuleName: (moduleName: string) => void;
  onChangeProduct: (product: string) => void;
  onChangeBuildMode: (buildMode: "debug" | "release") => void;
  onChangeFastMode: (fastMode: boolean) => void;
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
  onChangeTarget,
  onChangeModuleName,
  onChangeProduct,
  onChangeBuildMode,
  onChangeFastMode,
  onRunBuild,
  onRunCleanBuild,
  onStopBuild,
}: BuildToolWindowProps) {
  const running = state.status === "running";
  const hasWorkspace = Boolean(workspaceRootPath);
  const duration = formatDuration(state.lastDurationMs);

  function changeTarget(event: ChangeEvent<HTMLSelectElement>) {
    onChangeTarget(event.target.value as BuildTarget);
  }

  function changeBuildMode(event: ChangeEvent<HTMLSelectElement>) {
    onChangeBuildMode(event.target.value as "debug" | "release");
  }

  return (
    <section aria-label="Build Panel" className="build-tool-window">
      <div className="build-tool-window__toolbar">
        <button type="button" className="build-tool-window__button build-tool-window__button--primary" disabled={!hasWorkspace || running} onClick={onRunBuild}>
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
          <input value={state.moduleName} disabled={running || state.lastTarget === "app"} onChange={(event) => onChangeModuleName(event.target.value)} />
        </label>
        <label className="build-tool-window__field">
          <span>Product</span>
          <input value={state.product} disabled={running} onChange={(event) => onChangeProduct(event.target.value)} />
        </label>
        <label className="build-tool-window__field">
          <span>Mode</span>
          <select value={state.buildMode} disabled={running} onChange={changeBuildMode}>
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
      <pre className="build-tool-window__output">{state.output || "Build output will appear here."}</pre>
    </section>
  );
}
