import type { CodeMirrorSignatureHelpBroker } from "@/editor/codemirror-signature-help";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

export type CodeMirrorSignatureHelpBrokerDependencies = {
  workspaceApi: WorkspaceApi;
  getRootPath: () => string | null;
};

export function createCodeMirrorSignatureHelpBroker({
  workspaceApi,
  getRootPath,
}: CodeMirrorSignatureHelpBrokerDependencies): CodeMirrorSignatureHelpBroker {
  return async (request, signal) => {
    if (signal.aborted || !getRootPath() || !workspaceApi.signatureHelp) {
      return null;
    }
    const result = await workspaceApi.signatureHelp({
      path: request.path,
      line: request.line,
      column: request.column,
      content: request.content,
    });
    return signal.aborted ? null : result;
  };
}
