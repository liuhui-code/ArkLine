import { collectCompletionCandidateResult } from "@/components/layout/completion-candidate-provider";
import type { CodeMirrorCompletionBroker, CodeMirrorCompletionRequest } from "@/editor/codemirror-completion-source";
import { languageRequestTimeout } from "@/features/language/language-session-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

type CodeMirrorCompletionBrokerOptions = {
  workspaceApi: WorkspaceApi;
  getRootPath: () => string | null | undefined;
  ensureSemanticDocument: (path: string, content: string) => Promise<number | null>;
};

export function createCodeMirrorCompletionBroker({
  workspaceApi,
  getRootPath,
  ensureSemanticDocument,
}: CodeMirrorCompletionBrokerOptions): CodeMirrorCompletionBroker {
  let requestGeneration = 0;
  return async (request: CodeMirrorCompletionRequest) => {
    const rootPath = getRootPath();
    if (!rootPath) return [];

    const documentVersion = await ensureSemanticDocument(request.path, request.content);
    const result = await languageRequestTimeout(collectCompletionCandidateResult({
      workspaceApi,
      rootPath,
      path: request.path,
      line: request.line,
      column: request.column,
      content: request.content,
      semanticContent: documentVersion === null ? request.content : undefined,
      documentVersion,
      query: request.query,
      replacePrefix: request.replacePrefix,
      requestGeneration: ++requestGeneration,
    }), 2500);
    return result.items;
  };
}
