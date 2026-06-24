import { useEffect, useState } from "react";
import {
  createDefaultGitTraceState,
  isGitTraceUnavailable,
  type GitTraceState,
} from "@/features/git/git-trace-model";
import { mapBlameToBuffer } from "@/features/git/blame-buffer-mapper";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

type UseGitTraceArgs = {
  activeLine: number;
  activePath: string | null;
  activeText: string;
  baseText: string;
  activeTool: "problems" | "terminal" | "git" | "gitTrace" | "usages";
  workspaceApi: WorkspaceApi;
};

export function useGitTrace({ activeLine, activePath, activeText, baseText, activeTool, workspaceApi }: UseGitTraceArgs) {
  const [state, setState] = useState<GitTraceState>(createDefaultGitTraceState);

  useEffect(() => {
    if (!activePath || !workspaceApi.getFileBlame) {
      setState(createDefaultGitTraceState());
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
          blameAttributions: [],
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
        blameAttributions: [],
        selectedLine: null,
        selectedCommit: null,
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
        blameAttributions: [],
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
  }, [activePath, baseText, workspaceApi]);

  useEffect(() => {
    if (state.blameStatus !== "ready" || state.blameLines.length === 0) {
      return;
    }

    const blameAttributions = mapBlameToBuffer({ baseText, currentText: activeText, blameLines: state.blameLines });
    const selectedAttribution = blameAttributions.find((line) => line.bufferLine === activeLine && line.commit)
      ?? blameAttributions.find((line) => line.commit);

    setState((current) => ({
      ...current,
      blameAttributions,
      selectedLine: activeLine,
      selectedCommit: selectedAttribution?.commit ?? null,
    }));
  }, [activeLine, activeText, baseText, state.blameLines, state.blameStatus]);

  useEffect(() => {
    if (
      activeTool !== "gitTrace"
      || !activePath
      || !workspaceApi.getCommitTrace
      || state.blameStatus !== "ready"
      || state.blameAttributions.length === 0
    ) {
      return;
    }

    const selected = state.blameAttributions.find((line) => line.bufferLine === activeLine && line.commit)
      ?? state.blameAttributions.find((line) => line.commit);
    if (!selected?.commit) {
      return;
    }

    const selectedCommit = selected.commit;
    const selectedLine = selected.bufferLine;
    const selectedSourceLine = selected.sourceLine ?? selected.bufferLine;
    let cancelled = false;
    setState((current) => ({
      ...current,
      selectedLine,
      selectedCommit,
      detailStatus: "loading",
      message: current.blameStatus === "ready" ? undefined : current.message,
    }));

    void workspaceApi.getCommitTrace(activePath, selectedCommit, selectedSourceLine).then((result) => {
      if (cancelled) {
        return;
      }

      if (isGitTraceUnavailable(result)) {
        setState((current) => ({
          ...current,
          selectedLine,
          selectedCommit,
          detailStatus: "unavailable",
          detail: null,
          message: result.message,
        }));
        return;
      }

      setState((current) => ({
        ...current,
        selectedLine,
        selectedCommit,
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
        selectedLine,
        selectedCommit,
        detailStatus: "error",
        detail: null,
        message,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [activeLine, activePath, activeTool, state.blameAttributions, state.blameStatus, workspaceApi]);

  return { gitTraceState: state };
}
