import { EditorView, ViewUpdate } from "@codemirror/view";

export type EditorLineColumn = {
  line: number;
  column: number;
};

function toLineColumn(view: EditorView, position: number): EditorLineColumn {
  const line = view.state.doc.lineAt(position);
  return {
    line: line.number,
    column: position - line.from + 1,
  };
}

export function createDocumentChangeListener(onChange: (value: string) => void) {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!update.docChanged) {
      return;
    }

    onChange(update.state.doc.toString());
  });
}

export function createSelectionChangeListener(
  onSelectionChange: (selection: { line: number; column: number }) => void,
) {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!update.selectionSet && !update.docChanged) {
      return;
    }

    const head = update.state.selection.main.head;
    const text = update.state.doc.toString();
    const safeHead = Math.max(0, Math.min(head, text.length));
    const prefix = text.slice(0, safeHead);
    const segments = prefix.split("\n");
    const currentLine = segments.at(-1) ?? "";

    onSelectionChange({
      line: Math.max(segments.length, 1),
      column: currentLine.length + 1,
    });
  });
}

export function createDefinitionTriggerHandler(
  onDefinitionTrigger: (selection?: EditorLineColumn) => void,
) {
  function handleModifierPointerEvent(
    event: MouseEvent,
    view: EditorView,
    allowSecondaryButton: boolean,
  ) {
    if (!(event.ctrlKey || event.metaKey)) {
      return false;
    }

    const allowedButtons = allowSecondaryButton ? [0, 2] : [0];
    if (!allowedButtons.includes(event.button)) {
      return false;
    }

    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const selection = position == null ? undefined : toLineColumn(view, position);

    event.preventDefault();
    onDefinitionTrigger(selection);
    return true;
  }

  return EditorView.domEventHandlers({
    mousedown(event, view) {
      return handleModifierPointerEvent(event, view, false);
    },
    contextmenu(event, view) {
      return handleModifierPointerEvent(event, view, true);
    },
  });
}
