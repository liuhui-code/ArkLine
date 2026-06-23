import { useEffect, useState } from "react";
import {
  createDefaultGitTraceState,
  isGitTraceUnavailable,
  type GitTraceState,
} from "@/features/git/git-trace-model";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

type UseGitTraceArgs = {
  activeLine: number;
  activePath: string | null;
  isActiveFileDirty: boolean;
  activeTool: "problems" | "terminal" | "git" | "gitTrace" | "usages";
  workspaceApi: WorkspaceApi;
};

export function useGitTrace({ activeLine, activePath, isActiveFileDirty, activeTool, workspaceApi }: UseGitTraceArgs) {
  const [state, setState] = useState<GitTraceState>(createDefaultGitTraceState);

  useEffect(() => {
    if (!activePath || !workspaceApi.getFileBlame) {
      setState(createDefaultGitTraceState());
      return;
    }

    if (isActiveFileDirty) {
      setState({
        blameStatus: "unavailable",
        blameLines: [],
        selectedLine: null,
        selectedCommit: null,
        detailStatus: "unavailable",
        detail: null,
        message: "Save the current file to inspect Git Trace.",
      });
      return;
    }

    let cancelled = false;
    setState((current) => ({
      ...current,
      blameStatus: "loading",
      detailStatus: "idle",
      detail: null,
      message: undefined,
    }));

    void workspaceApi.getFileBlame(activePath).then((result) => {
      if (cancelled) {
        return;
      }

      if (isGitTraceUnavailable(result)) {
        setState((current) => ({
          ...current,
          blameStatus: "unavailable",
          blameLines: [],
          selectedLine: null,
          selectedCommit: null,
          detailStatus: "unavailable",
          detail: null,
          message: result.message,
        }));
        return;
      }

      setState((current) => ({
        ...current,
        blameStatus: "ready",
        blameLines: result,
        selectedLine: activeLine,
        selectedCommit: result.find((line) => line.line === activeLine)?.commit ?? result[0]?.commit ?? null,
        message: undefined,
      }));
    }).catch((error) => {
      if (cancelled) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      setState((current) => ({
        ...current,
        blameStatus: "error",
        blameLines: [],
        selectedLine: null,
        selectedCommit: null,
        detailStatus: "error",
        detail: null,
        message,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [activeLine, activePath, isActiveFileDirty, workspaceApi]);

  useEffect(() => {
    if (
      activeTool !== "gitTrace"
      || !activePath
      || !workspaceApi.getCommitTrace
      || state.blameStatus !== "ready"
      || state.blameLines.length === 0
    ) {
      return;
    }

    const selected = state.blameLines.find((line) => line.line === activeLine) ?? state.blameLines[0];
    if (!selected) {
      return;
    }

    let cancelled = false;
    setState((current) => ({
      ...current,
      selectedLine: selected.line,
      selectedCommit: selected.commit,
      detailStatus: "loading",
      message: current.blameStatus === "ready" ? undefined : current.message,
    }));

    void workspaceApi.getCommitTrace(activePath, selected.commit, selected.line).then((result) => {
      if (cancelled) {
        return;
      }

      if (isGitTraceUnavailable(result)) {
        setState((current) => ({
          ...current,
          selectedLine: selected.line,
          selectedCommit: selected.commit,
          detailStatus: "unavailable",
          detail: null,
          message: result.message,
        }));
        return;
      }

      setState((current) => ({
        ...current,
        selectedLine: selected.line,
        selectedCommit: selected.commit,
        detailStatus: "ready",
        detail: result,
        message: undefined,
      }));
    }).catch((error) => {
      if (cancelled) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      setState((current) => ({
        ...current,
        selectedLine: selected.line,
        selectedCommit: selected.commit,
        detailStatus: "error",
        detail: null,
        message,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [activeLine, activePath, activeTool, state.blameLines, state.blameStatus, workspaceApi]);

  return { gitTraceState: state };
}
