import type { CodeAction } from "@/features/code-actions/code-action-model";
import {
  searchWorkspaceText as searchWorkspaceTextInMemory,
  type WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";
import {
  collectFallbackCompletions,
  collectFallbackDocumentSymbols,
} from "@/features/workspace/fallback-symbols";
import type { UsageResult } from "@/features/workspace/usage-search";
import {
  demoWorkspace,
  isDemoWorkspacePath,
  listDirectoryFromSnapshot,
  loadMockDocumentContent,
  loadWorkspaceSnapshot,
} from "@/features/workspace/workspace-api-browser-support";
import type {
  ApplyWorkspaceEditResult,
  CodeActionResolution,
  DefinitionCandidate,
  DefinitionTarget,
  EnvironmentReport,
  HoverResponse,
  LanguageCompletionItem,
  LanguageServiceReport,
  ValidationProblem,
  WorkspaceApi,
  WorkspaceDirectoryEntry,
  WorkspaceEditPreview,
} from "@/features/workspace/workspace-api-contract";
import { hasTauriRuntime, invoke, open } from "@/features/workspace/workspace-api-runtime";
import { normalizePath } from "@/features/workspace/workspace-store";

export function createWorkspaceCoreApi(): Partial<WorkspaceApi> {
  return {
    async pickWorkspaceRoot() {
      if (!hasTauriRuntime()) return null;

      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open ArkTS Project",
      });
      return typeof selected === "string" ? normalizePath(selected) : null;
    },
    async pickPath(options) {
      if (!hasTauriRuntime()) return null;

      const selected = await open({
        directory: options.directory ?? false,
        multiple: false,
        title: options.title,
      });
      return typeof selected === "string" ? normalizePath(selected) : null;
    },
    openWorkspace: loadWorkspaceSnapshot,
    async listWorkspaceDirectory(rootPath, directoryPath) {
      if (hasTauriRuntime()) {
        return invoke<WorkspaceDirectoryEntry[]>("list_workspace_directory", { rootPath, directoryPath });
      }

      const snapshot = await loadWorkspaceSnapshot(rootPath);
      return listDirectoryFromSnapshot(snapshot, directoryPath);
    },
    async searchWorkspaceText(request) {
      if (hasTauriRuntime()) {
        return invoke<WorkspaceTextSearchResult>("search_workspace_text", { request });
      }

      const snapshot = await loadWorkspaceSnapshot(request.rootPath);
      return searchWorkspaceTextInMemory({
        query: request.query,
        rootPath: request.rootPath,
        paths: snapshot.files,
        options: request.options,
        limit: request.limit,
        contextLines: request.contextLines,
        readFile: loadMockDocumentContent,
      });
    },
    async openWorkspaceInNewWindow(rootPath) {
      if (hasTauriRuntime()) {
        await invoke("open_workspace_in_new_window", { rootPath });
      }
    },
    async getLaunchWorkspacePath() {
      return hasTauriRuntime() ? invoke<string | null>("get_launch_workspace_path") : null;
    },
    async openDemoWorkspace() {
      return loadWorkspaceSnapshot(demoWorkspace.rootPath);
    },
    async openFile(path) {
      return hasTauriRuntime()
        ? invoke<string>("open_text_document", { path })
        : loadMockDocumentContent(path);
    },
    async saveFile(path, content) {
      if (hasTauriRuntime()) {
        await invoke("save_text_document", { path, content });
      }
    },
    async runValidation(path, content) {
      if (hasTauriRuntime()) {
        return invoke<ValidationProblem[]>("validate_text_document", { path, content });
      }
      return validateBrowserDocument(path, content);
    },
    async loadDiff(rootPath) {
      if (hasTauriRuntime()) {
        return invoke<string>("load_workspace_diff", { rootPath });
      }

      return `diff --git a/src/main.ets b/src/main.ets
--- a/src/main.ets
+++ b/src/main.ets
@@ -1,2 +1,3 @@
 @Entry
-struct Index {}
+struct Index {
+}`;
    },
    async inspectEnvironment() {
      if (hasTauriRuntime()) {
        return invoke<EnvironmentReport>("inspect_environment");
      }

      return {
        tools: [
          { name: "git", available: true, detail: "git version 2.x" },
          { name: "rg", available: false, detail: "Bundled ripgrep not configured yet" },
          { name: "lintCommand", available: false, detail: "arklint: not configured on this machine" },
          { name: "formatCommand", available: false, detail: "arkfmt: not configured on this machine" },
          { name: "arktsLanguageServer", available: false, detail: "Not bundled yet" },
          { name: "webview2", available: true, detail: "Installer enforces minimum version on Windows" },
        ],
      };
    },
    async inspectLanguageService() {
      if (hasTauriRuntime()) {
        return invoke<LanguageServiceReport>("inspect_language_service");
      }

      return {
        provider: "mock-fallback",
        mode: "fallback",
        running: true,
        hover: true,
        definition: true,
        completion: true,
        documentSymbols: true,
        findUsages: true,
        detail: "Mock fallback ArkTS language service for demo and integration-shell wiring",
      };
    },
    async hoverSymbol(request) {
      if (hasTauriRuntime()) {
        return invoke<HoverResponse | null>("hover_symbol", { request });
      }
      if (!isDemoWorkspacePath(request.path)) return null;

      return {
        contents: request.line <= 2
          ? "@Entry decorates the HarmonyOS application entry component."
          : "Index is the root component in this demo ArkTS file.",
      };
    },
    async gotoDefinition(request) {
      if (hasTauriRuntime()) {
        return invoke<DefinitionTarget | null>("goto_definition", { request });
      }
      if (!isDemoWorkspacePath(request.path)) return null;

      return { path: normalizePath(request.path), line: request.line <= 2 ? 1 : 3, column: 1 };
    },
    async gotoDefinitionCandidates(request) {
      if (hasTauriRuntime()) {
        return invoke<DefinitionCandidate[]>("goto_definition_candidates", { request });
      }
      return [];
    },
    async completeSymbol(request) {
      if (hasTauriRuntime()) {
        return invoke<LanguageCompletionItem[]>("complete_symbol", { request });
      }
      if (!isDemoWorkspacePath(request.path)) return [];

      return collectFallbackCompletions(await loadMockDocumentContent(request.path));
    },
    async documentSymbols(request) {
      if (hasTauriRuntime()) {
        return invoke("document_symbols", { request });
      }
      if (!isDemoWorkspacePath(request.path)) return [];

      return collectFallbackDocumentSymbols(await loadMockDocumentContent(request.path));
    },
    async findUsages(request) {
      if (hasTauriRuntime()) {
        return invoke<UsageResult[]>("find_usages", { request });
      }
      if (!isDemoWorkspacePath(request.path)) return [];

      return [
        { path: normalizePath(request.path), line: 1, column: 1, preview: "@Entry", kind: "fallback", confidence: "fallback" },
        { path: normalizePath(request.path), line: 3, column: 8, preview: "struct Index {}", kind: "fallback", confidence: "fallback" },
      ];
    },
    async listCodeActions(request) {
      if (hasTauriRuntime()) {
        return invoke<CodeAction[]>("list_code_actions", { request });
      }
      if (!isDemoWorkspacePath(request.path) || !request.path.toLowerCase().endsWith(".ets")) return [];

      return [
        codeAction("arkts.generate.page", "Generate ArkTS Page", "generate", { template: "arkts-page" }),
        codeAction("arkts.generate.component", "Generate ArkTS Component", "generate", { template: "arkts-component" }),
        codeAction("workspace.renameFile", "Rename File", "source", { targetPath: normalizePath(request.path) }),
      ];
    },
    async resolveCodeAction(request) {
      if (hasTauriRuntime()) {
        return invoke<CodeActionResolution>("resolve_code_action", { request });
      }

      return {
        status: "unsupported",
        reason: `Resolving code action '${request.id}' is not implemented in the mock workspace API.`,
      };
    },
    async previewWorkspaceEdit(request) {
      if (hasTauriRuntime()) {
        return invoke<WorkspaceEditPreview>("preview_workspace_edit", { request });
      }

      const affectedFiles = request.plan.affectedFiles.length > 0
        ? request.plan.affectedFiles
        : request.plan.operations.flatMap((operation) => {
            if (operation.kind === "renameFile" || operation.kind === "renameDirectory") {
              return [operation.oldPath, operation.newPath];
            }
            return [operation.path];
          });

      return {
        plan: request.plan,
        conflicts: request.plan.conflicts,
        affectedFiles: [...new Set(affectedFiles)],
        summary: request.plan.operations.map((operation) => operation.kind),
      };
    },
    async applyWorkspaceEdit(request) {
      if (hasTauriRuntime()) {
        return invoke<ApplyWorkspaceEditResult>("apply_workspace_edit", { request });
      }

      return {
        applied: false,
        conflicts: [{
          path: request.workspaceRoot,
          message: "Applying workspace edits is only available in the Tauri runtime.",
        }],
        changedFiles: [],
      };
    },
  };
}

function validateBrowserDocument(path: string, content: string): ValidationProblem[] {
  const diagnostics: ValidationProblem[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (line.includes("\t")) {
      diagnostics.push({
        source: "format",
        severity: "warning",
        path,
        line: index + 1,
        column: line.indexOf("\t") + 1,
        message: "Replace tabs with spaces",
      });
    }

    if (line.trimStart().startsWith("console.log(")) {
      diagnostics.push({
        source: "lint",
        severity: "warning",
        path,
        line: index + 1,
        column: line.indexOf("console.log(") + 1,
        message: "Remove console.log before committing",
      });
    }
  });

  if (!content.endsWith("\n")) {
    diagnostics.push({
      source: "format",
      severity: "warning",
      path,
      line: lines.length,
      column: lines.at(-1)?.length ?? 1,
      message: "File should end with a newline",
    });
  }

  return diagnostics;
}

function codeAction(id: string, title: string, kind: CodeAction["kind"], data: Record<string, string>): CodeAction {
  return {
    id,
    title,
    kind,
    provider: kind === "source" ? "workspace" : "template",
    safety: "needsPreview",
    data,
  };
}
