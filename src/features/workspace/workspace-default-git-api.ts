import type { GitBlameLine, GitCommitTrace, GitTraceUnavailable } from "@/features/git/git-trace-model";
import {
  isDemoWorkspacePath,
} from "@/features/workspace/workspace-api-browser-support";
import type { WorkspaceApi } from "@/features/workspace/workspace-api-contract";
import { hasTauriRuntime, invoke } from "@/features/workspace/workspace-api-runtime";
import { normalizePath } from "@/features/workspace/workspace-store";

export function createWorkspaceGitApi(): Partial<WorkspaceApi> {
  return {
    async getFileBlame(path) {
      if (hasTauriRuntime()) {
        return invoke<GitBlameLine[] | GitTraceUnavailable>("get_file_blame", { path });
      }

      if (!isDemoWorkspacePath(path)) {
        return {
          kind: "unavailable",
          reason: "notTracked",
          message: "File is not tracked by Git",
        };
      }

      return [
        {
          line: 1,
          commit: "abc1234",
          sourceLine: 1,
          author: "Jane Doe",
          authoredAt: "2026-06-23T10:00:00Z",
          relativeTime: "2h ago",
          summary: "Mark ArkTS entry component",
        },
        {
          line: 2,
          commit: "abc1234",
          sourceLine: 2,
          author: "Jane Doe",
          authoredAt: "2026-06-23T10:00:00Z",
          relativeTime: "2h ago",
          summary: "Mark ArkTS entry component",
        },
        {
          line: 3,
          commit: "def5678",
          sourceLine: 3,
          author: "Alex Chen",
          authoredAt: "2026-06-22T15:30:00Z",
          relativeTime: "1d ago",
          summary: "Add root Index struct",
        },
      ];
    },
    async getCommitTrace(path, commit, line) {
      if (hasTauriRuntime()) {
        return invoke<GitCommitTrace | GitTraceUnavailable>("get_commit_trace", { path, commit, line });
      }

      if (!isDemoWorkspacePath(path)) {
        return {
          kind: "unavailable",
          reason: "detailUnavailable",
          message: "Commit details unavailable",
        };
      }

      return {
        commit,
        shortCommit: commit.slice(0, 7),
        author: commit === "abc1234" ? "Jane Doe" : "Alex Chen",
        email: commit === "abc1234" ? "jane@example.com" : "alex@example.com",
        authoredAt: commit === "abc1234" ? "2026-06-23T10:00:00Z" : "2026-06-22T15:30:00Z",
        subject: commit === "abc1234" ? "Mark ArkTS entry component" : "Add root Index struct",
        relativePath: normalizePath(path).replace(/^.*DemoWorkspace[\\/]/, "").replace(/\\/g, "/"),
        selectedLine: line,
        sourceLine: line,
        patch: commit === "abc1234"
          ? "@@ -1,2 +1,2 @@\n+@Entry\n @Component"
          : "@@ -1,3 +1,3 @@\n @Entry\n @Component\n+struct Index {}",
      };
    },
  };
}
