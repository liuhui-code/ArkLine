import { collectCompletionCandidateResult } from "@/components/layout/completion-candidate-provider";
import type {
  CodeMirrorCompletionBroker,
  CodeMirrorCompletionRequest,
  CodeMirrorCompletionResolver,
} from "@/editor/codemirror-completion-source";
import { languageRequestTimeout } from "@/features/language/language-session-store";
import type { SemanticDocumentSnapshot } from "@/features/semantic/semantic-document-sync";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import { formatQueryEnvelopeExplain } from "@/features/workspace/workspace-query-explain-model";

type CodeMirrorCompletionBrokerOptions = {
  workspaceApi: WorkspaceApi;
  getRootPath: () => string | null | undefined;
  ensureSemanticDocument: (path: string, snapshot: SemanticDocumentSnapshot) => Promise<number | null>;
  onResult?: (request: CodeMirrorCompletionRequest, result: CompletionCandidateResult) => void;
};

type CompletionCandidateResult = Awaited<ReturnType<typeof collectCompletionCandidateResult>>;

export function createCodeMirrorCompletionBroker({
  workspaceApi,
  getRootPath,
  ensureSemanticDocument,
  onResult,
}: CodeMirrorCompletionBrokerOptions): CodeMirrorCompletionBroker {
  let requestGeneration = 0;
  return async (request: CodeMirrorCompletionRequest) => {
    const rootPath = getRootPath();
    if (!rootPath) return [];

    const documentVersion = await ensureSemanticDocument(request.path, request.document);
    const content = documentVersion === null ? request.document.toString() : request.lineText;
    const result = await languageRequestTimeout(collectCompletionCandidateResult({
      workspaceApi,
      rootPath,
      path: request.path,
      line: request.line,
      column: request.column,
      content,
      contextLineText: request.lineText,
      semanticContent: documentVersion === null ? content : undefined,
      documentVersion,
      query: request.query,
      replacePrefix: request.replacePrefix,
      requestGeneration: ++requestGeneration,
    }), 2500);
    onResult?.(request, result);
    return result.items;
  };
}

export function createCodeMirrorCompletionResultReporter(
  onStatusChange: (message: string) => void,
  recordExplain: (entry: { kind: "completion"; query: string; message: string; explain?: string[] }) => void,
) {
  return (request: CodeMirrorCompletionRequest, result: CompletionCandidateResult) => {
    if (result.items.length > 0) return;
    const explanation = formatQueryEnvelopeExplain(result.explain);
    const message = explanation ?? "Completion empty";
    onStatusChange(message);
    if (!explanation) return;
    const fallback = `${request.path.replace(/\\/g, "/").split("/").pop()}:${request.line}:${request.column}`;
    recordExplain({ kind: "completion", query: request.query || request.replacePrefix || fallback, message, explain: result.explain });
  };
}

export function createCodeMirrorCompletionResolver(
  workspaceApi: WorkspaceApi,
): CodeMirrorCompletionResolver {
  return async (item, request) => {
    if (!workspaceApi.resolveCompletion || item.data?.provider !== "typescript") return item;
    const documentVersion = typeof item.data.documentVersion === "number"
      ? item.data.documentVersion
      : undefined;
    return workspaceApi.resolveCompletion({
      path: request.path,
      line: request.line,
      column: request.column,
      ...(documentVersion === undefined ? { content: request.document.toString() } : {}),
      ...(documentVersion === undefined ? {} : { documentVersion }),
    }, item, documentVersion);
  };
}
