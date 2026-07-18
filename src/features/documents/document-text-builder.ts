import { Text } from "@codemirror/state";
import {
  DOCUMENT_ACTIVATION_YIELD_THRESHOLD,
  yieldDocumentActivationTask,
} from "@/features/documents/document-activation-scheduler";

export type DocumentTextBuilderOptions = {
  chunkSize?: number;
  yieldTask?: () => Promise<void>;
};

export async function buildDocumentText(
  content: string,
  options: DocumentTextBuilderOptions = {},
) {
  const chunkSize = Math.max(1, options.chunkSize ?? DOCUMENT_ACTIVATION_YIELD_THRESHOLD);
  if (content.length < chunkSize) {
    return Text.of(content.split("\n"));
  }

  const yieldTask = options.yieldTask ?? yieldDocumentActivationTask;
  let document = Text.empty;
  for (let offset = 0; offset < content.length; offset += chunkSize) {
    const end = Math.min(content.length, offset + chunkSize);
    document = document.append(Text.of(content.slice(offset, end).split("\n")));
    if (end < content.length) await yieldTask();
  }
  return document;
}
