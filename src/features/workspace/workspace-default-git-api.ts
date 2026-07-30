import type { GitBlameLine, GitCommitTrace, GitTraceUnavailable } from "@/features/git/git-trace-model";
import type { GitBranchSnapshot, GitCheckoutBranchResult } from "@/features/git/git-branch-model";
import type { GitCommitDetails, GitHistoryPage } from "@/features/git/git-history-model";
import type { GitStashPage } from "@/features/git/git-stash-model";
import type { GitConflictContent, GitDiffResult, GitDiscardResult, GitFileComparison, GitMutationResult, GitPatchMutationResult, GitRepositorySnapshot } from "@/features/git/git-source-control-model";
import {
  isDemoWorkspacePath,
} from "@/features/workspace/workspace-api-browser-support";
import type { WorkspaceApi } from "@/features/workspace/workspace-api-contract";
import { hasTauriRuntime, invoke } from "@/features/workspace/workspace-api-runtime";
import { normalizePath } from "@/features/workspace/workspace-store";

export function createWorkspaceGitApi(): Partial<WorkspaceApi> {
  return {
    async getGitRepositorySnapshot(request) {
      if (hasTauriRuntime()) return invoke<GitRepositorySnapshot>("get_git_repository_snapshot", { request });
      return demoRepositorySnapshot(request.rootPath);
    },
    async cancelGitQuery(requestId) {
      if (hasTauriRuntime()) return invoke<boolean>("cancel_git_query", { requestId });
      return false;
    },
    async getGitFileDiff(request) {
      if (hasTauriRuntime()) return invoke<GitDiffResult>("get_git_file_diff", { request });
      return demoDiff(request.relativePath, request.staged);
    },
    async getGitFileComparison(request) {
      if (hasTauriRuntime()) return invoke<GitFileComparison>("get_git_file_comparison", { request });
      const patch = demoDiff(request.relativePath, request.staged);
      const content = "@Entry\n@Component\nstruct Main {}\n";
      return {
        relativePath: request.relativePath,
        staged: request.staged,
        before: { exists: true, binary: false, content: "@Entry\nstruct Main {}\n", truncated: false, totalBytes: 22 },
        after: { exists: true, binary: false, content, truncated: false, totalBytes: content.length },
        patch,
      };
    },
    async stageGitPaths(request) {
      if (hasTauriRuntime()) return invoke<GitMutationResult>("stage_git_paths", { request });
      return demoMutation(request.rootPath, `Staged ${request.paths.length} file(s)`);
    },
    async unstageGitPaths(request) {
      if (hasTauriRuntime()) return invoke<GitMutationResult>("unstage_git_paths", { request });
      return demoMutation(request.rootPath, `Unstaged ${request.paths.length} file(s)`);
    },
    async discardGitPaths(request) {
      if (hasTauriRuntime()) return invoke<GitDiscardResult>("discard_git_paths", { request });
      return {
        message: `Discarded ${request.paths.length} path(s). Safety backup is available.`,
        backupCommit: "0123456789012345678901234567890123456789",
        snapshot: { ...demoRepositorySnapshot(request.rootPath), changes: [], totalChanges: 0 },
      };
    },
    async restoreGitDiscard(request) {
      if (hasTauriRuntime()) return invoke<GitMutationResult>("restore_git_discard", { request });
      return demoMutation(request.rootPath, "Discarded changes restored");
    },
    async applyGitPartialPatch(request) {
      if (hasTauriRuntime()) return invoke<GitPatchMutationResult>("apply_git_partial_patch", { request });
      return {
        message: `${request.action === "stage" ? "Staged" : request.action === "unstage" ? "Unstaged" : "Discarded"} selected changes: ${request.relativePath}`,
        backupCommit: request.action === "discard" ? "0123456789012345678901234567890123456789" : null,
        snapshot: demoMutation(request.rootPath, "Applied selected changes").snapshot,
      };
    },
    async restoreGitPartialPatch(request) {
      if (hasTauriRuntime()) return invoke<GitMutationResult>("restore_git_partial_patch", { request });
      return demoMutation(request.rootPath, `Discarded selection restored: ${request.relativePath}`);
    },
    async commitGitChanges(request) {
      if (hasTauriRuntime()) return invoke<GitMutationResult>("commit_git_changes", { request });
      return { message: `Committed ${request.message}`, snapshot: { ...demoRepositorySnapshot(request.rootPath), changes: [] } };
    },
    async runGitRemoteOperation(request) {
      if (hasTauriRuntime()) return invoke<GitMutationResult>("run_git_remote_operation", { request });
      const message = request.operation === "fetch" ? "Fetched origin" : request.operation === "pull" ? "Pulled with fast-forward only" : "Pushed to origin";
      return demoMutation(request.rootPath, message);
    },
    async getGitHistory(request) {
      if (hasTauriRuntime()) return invoke<GitHistoryPage>("get_git_history", { request });
      return demoHistoryPage(request.cursor);
    },
    async getGitCommitDetails(request) {
      if (hasTauriRuntime()) return invoke<GitCommitDetails>("get_git_commit_details", { request });
      return demoCommitDetails(request.commit);
    },
    async getGitCommitDiff(request) {
      if (hasTauriRuntime()) return invoke<GitDiffResult>("get_git_commit_diff", { request });
      return demoDiff("src/main.ets", true);
    },
    async getGitCommitFileDiff(request) {
      if (hasTauriRuntime()) return invoke<GitDiffResult>("get_git_commit_file_diff", { request });
      return demoDiff(request.relativePath, true);
    },
    async runGitHistoryAction(request) {
      if (hasTauriRuntime()) return invoke<GitMutationResult>("run_git_history_action", { request });
      const label = request.action === "cherryPick" ? "Cherry-picked" : "Reverted";
      return demoMutation(request.rootPath, `${label} ${request.commit.slice(0, 7)}`);
    },
    async getGitConflictContent(request) {
      if (hasTauriRuntime()) return invoke<GitConflictContent>("get_git_conflict_content", { request });
      return demoConflictContent(request.relativePath);
    },
    async resolveGitConflict(request) {
      if (hasTauriRuntime()) return invoke<GitMutationResult>("resolve_git_conflict", { request });
      return demoMutation(request.rootPath, `Resolved ${request.relativePath}`);
    },
    async runGitRepositoryAction(request) {
      if (hasTauriRuntime()) return invoke<GitMutationResult>("run_git_repository_action", { request });
      return demoMutation(request.rootPath, `Git operation ${request.action}d`);
    },
    async getGitStashes(request) {
      if (hasTauriRuntime()) return invoke<GitStashPage>("get_git_stashes", { request });
      return demoStashPage(request.cursor, request.limit);
    },
    async createGitStash(request) {
      if (hasTauriRuntime()) return invoke<GitMutationResult>("create_git_stash", { request });
      return demoMutation(request.rootPath, request.message ? `Stashed local changes: ${request.message}` : "Stashed local changes");
    },
    async runGitStashAction(request) {
      if (hasTauriRuntime()) return invoke<GitMutationResult>("run_git_stash_action", { request });
      const label = request.action === "apply" ? "Applied" : request.action === "pop" ? "Popped" : "Dropped";
      return demoMutation(request.rootPath, `${label} ${request.reference}`);
    },
    async getGitStashDiff(request) {
      if (hasTauriRuntime()) return invoke<GitDiffResult>("get_git_stash_diff", { request });
      return demoDiff("src/main.ets", false);
    },
    async listGitBranches(rootPath) {
      if (hasTauriRuntime()) {
        return invoke<GitBranchSnapshot>("list_git_branches", { rootPath });
      }
      return demoBranchSnapshot(rootPath);
    },
    async checkoutGitBranch(request) {
      if (hasTauriRuntime()) {
        return invoke<GitCheckoutBranchResult>("checkout_git_branch", { request });
      }
      return {
        snapshot: demoBranchSnapshot(request.rootPath, request.name.startsWith("origin/") ? request.name.slice("origin/".length) : request.name),
        message: `Switched to ${request.name}`,
        stashRestored: request.strategy === "stash",
        stashKept: false,
      };
    },
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

function demoBranchSnapshot(rootPath: string, currentBranch = "main"): GitBranchSnapshot {
  return {
    rootPath: normalizePath(rootPath),
    currentBranch,
    detached: false,
    localBranches: [
      { name: "main", displayName: "main", kind: "local", current: currentBranch === "main", favorite: true, upstream: "origin/main", ahead: 0, behind: 0 },
      { name: "feature/editor", displayName: "feature/editor", kind: "local", current: currentBranch === "feature/editor", favorite: false, upstream: "origin/feature/editor", ahead: 0, behind: 0 },
    ],
    remoteBranches: [
      { name: "origin/main", displayName: "origin/main", kind: "remote", current: false, favorite: false, upstream: null, ahead: 0, behind: 0 },
    ],
    recentBranches: [currentBranch, "main"].filter((name, index, names) => names.indexOf(name) === index),
    workingTree: { dirty: false, changedFiles: 0, conflictedFiles: 0 },
  };
}

function demoStashPage(cursor: number | null, limit: number): GitStashPage {
  const entries = [
    { index: 0, reference: "stash@{0}", commit: "fedcba987654321", subject: "On main: Refine editor navigation", createdAtEpochSeconds: 1785371400 },
    { index: 1, reference: "stash@{1}", commit: "1234567890abcdef", subject: "On feature/git: WIP source control", createdAtEpochSeconds: 1785283200 },
  ];
  const offset = cursor ?? 0;
  const page = entries.slice(offset, offset + limit);
  const nextCursor = offset + page.length < entries.length ? offset + page.length : null;
  return { entries: page, total: entries.length, nextCursor, hasMore: nextCursor !== null };
}

function demoHistoryPage(cursor: string | null): GitHistoryPage {
  if (cursor) return { commits: [], nextCursor: null, hasMore: false };
  return {
    commits: [
      { commit: "abc1234567890", shortCommit: "abc1234", parents: ["def5678901234"], refs: ["HEAD -> main", "origin/main"], subject: "Improve Source Control workflow", author: "Jane Doe", authorEmail: "jane@example.com", authoredAtEpochSeconds: 1785283200, graph: "*" },
      { commit: "def5678901234", shortCommit: "def5678", parents: [], refs: [], subject: "Create ArkTS workspace", author: "Alex Chen", authorEmail: "alex@example.com", authoredAtEpochSeconds: 1785196800, graph: "*" },
    ],
    nextCursor: null,
    hasMore: false,
  };
}

function demoCommitDetails(commit: string): GitCommitDetails {
  const initialCommit = commit.startsWith("def5678");
  const subject = initialCommit ? "Create ArkTS workspace" : "Improve Source Control workflow";
  return {
    commit,
    shortCommit: commit.slice(0, 7),
    parents: initialCommit ? [] : ["def5678901234"],
    author: initialCommit ? "Alex Chen" : "Jane Doe",
    authorEmail: initialCommit ? "alex@example.com" : "jane@example.com",
    authoredAtEpochSeconds: initialCommit ? 1785196800 : 1785283200,
    subject,
    body: subject,
    files: [{ status: "M", path: "src/main.ets", previousPath: null }],
    filesTruncated: false,
  };
}

function demoConflictContent(relativePath: string): GitConflictContent {
  return {
    relativePath,
    base: { exists: true, binary: false, content: "const value = 'base';\n" },
    current: { exists: true, binary: false, content: "const value = 'current';\n" },
    incoming: { exists: true, binary: false, content: "const value = 'incoming';\n" },
    result: "<<<<<<< HEAD\nconst value = 'current';\n=======\nconst value = 'incoming';\n>>>>>>> incoming\n",
    binary: false,
  };
}

function demoRepositorySnapshot(rootPath: string): GitRepositorySnapshot {
  const root = normalizePath(rootPath);
  return {
    rootPath: root,
    repositoryRoot: root,
    currentBranch: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    operation: "idle",
    generation: 1,
    snapshotId: "demo-status-1",
    totalChanges: 1,
    stagedChanges: 0,
    conflictedChanges: 0,
    nextCursor: null,
    hasMore: false,
    changes: [
      { relativePath: "src/main.ets", absolutePath: `${root}/src/main.ets`, originalPath: null, statusCode: ".M", kind: "modified", staged: false, unstaged: true, conflicted: false },
    ],
  };
}

function demoMutation(rootPath: string, message: string): GitMutationResult {
  return { message, snapshot: demoRepositorySnapshot(rootPath) };
}

function demoDiff(path: string, staged: boolean): GitDiffResult {
  const content = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,2 +1,3 @@\n @Entry\n-struct Index {}\n+struct Index {\n+  // ${staged ? "staged" : "working tree"}\n+}`;
  return { content, truncated: false, totalBytes: content.length };
}
