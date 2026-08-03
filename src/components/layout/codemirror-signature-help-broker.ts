import type { Text } from "@codemirror/state";
import type { CodeMirrorSignatureHelpBroker } from "@/editor/codemirror-signature-help";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

export type CodeMirrorSignatureHelpBrokerDependencies = {
  workspaceApi: WorkspaceApi;
  getRootPath: () => string | null;
  ensureSemanticDocument?: (path: string, document: Text) => Promise<number | null>;
};

export function createCodeMirrorSignatureHelpBroker({
  workspaceApi,
  getRootPath,
  ensureSemanticDocument,
}: CodeMirrorSignatureHelpBrokerDependencies): CodeMirrorSignatureHelpBroker {
  return async (request, signal) => {
    if (signal.aborted || !getRootPath() || !workspaceApi.signatureHelp) {
      return null;
    }
    const documentVersion = ensureSemanticDocument
      ? await ensureSemanticDocument(request.path, request.document)
      : null;
    if (signal.aborted) return null;
    const result = await workspaceApi.signatureHelp({
      path: request.path,
      line: request.line,
      column: request.column,
      ...(documentVersion === null
        ? { content: request.document.toString() }
        : { documentVersion }),
    });
    return signal.aborted ? null : result;
  };
}
