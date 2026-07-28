import { pickedCompletion, type Completion } from "@codemirror/autocomplete";
import type { EditorState, Text, TransactionSpec } from "@codemirror/state";

export type CompletionTextChange = {
  from: number;
  to: number;
  insert: string;
};

export type CompletionTransactionRequest = {
  state: EditorState;
  expectedDocument: Text;
  from: number;
  to: number;
  insertText: string;
  additionalChanges?: CompletionTextChange[];
  completion?: Completion;
};

export function createVersionCheckedCompletionTransaction(
  request: CompletionTransactionRequest,
): TransactionSpec | null {
  const { state, expectedDocument, from, to, insertText, additionalChanges = [], completion } = request;
  if (state.doc !== expectedDocument || !isRange(state, from, to)) {
    return null;
  }

  const changes: CompletionTextChange[] = [
    { from, to, insert: insertText },
    ...additionalChanges,
  ];
  const orderedChanges = [...changes].sort((left, right) => left.from - right.from || left.to - right.to);
  if (!areValidNonOverlappingChanges(state, orderedChanges)) {
    return null;
  }

  const changeSet = state.changes(orderedChanges);
  const annotations = completion ? [pickedCompletion.of(completion)] : [];
  return {
    changes: orderedChanges,
    selection: { anchor: changeSet.mapPos(to, 1) },
    annotations,
    scrollIntoView: true,
    userEvent: "input.complete",
  };
}

function isRange(state: EditorState, from: number, to: number) {
  return Number.isInteger(from)
    && Number.isInteger(to)
    && from >= 0
    && to >= from
    && to <= state.doc.length;
}

function areValidNonOverlappingChanges(state: EditorState, changes: CompletionTextChange[]) {
  const ordered = [...changes].sort((left, right) => left.from - right.from || left.to - right.to);
  return ordered.every((change, index) => {
    if (!isRange(state, change.from, change.to) || typeof change.insert !== "string") {
      return false;
    }
    const previous = ordered[index - 1];
    return !previous || previous.to <= change.from;
  });
}
