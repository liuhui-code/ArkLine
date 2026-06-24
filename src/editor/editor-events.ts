import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet, ViewUpdate } from "@codemirror/view";

export type EditorLineColumn = {
  line: number;
  column: number;
};

export type EditorCaretRect = EditorLineColumn & {
  top: number;
  left: number;
  bottom: number;
  right: number;
  measured: boolean;
};

export type DefinitionHoverState = {
  active: boolean;
  selection?: EditorLineColumn;
  from?: number;
  to?: number;
};

type DefinitionHoverRange = {
  from: number;
  to: number;
};

const definitionHoverDecoration = Decoration.mark({
  class: "cm-arkline-definition-hover",
});

const setDefinitionHoverEffect = StateEffect.define<DefinitionHoverRange | null>();
export const setJumpRevealEffect = StateEffect.define<DefinitionHoverRange | null>();

export const definitionHoverDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setDefinitionHoverEffect)) {
        continue;
      }

      if (!effect.value) {
        return Decoration.none;
      }

      return Decoration.set([
        definitionHoverDecoration.range(effect.value.from, effect.value.to),
      ]);
    }

    if (transaction.docChanged) {
      return Decoration.none;
    }

    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const jumpRevealDecoration = Decoration.mark({
  class: "cm-arkline-jump-reveal",
});

export const jumpRevealDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setJumpRevealEffect)) {
        continue;
      }

      if (!effect.value) {
        return Decoration.none;
      }

      return Decoration.set([
        jumpRevealDecoration.range(effect.value.from, effect.value.to),
      ]);
    }

    if (transaction.docChanged) {
      return Decoration.none;
    }

    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function toLineColumn(view: EditorView, position: number): EditorLineColumn {
  const line = view.state.doc.lineAt(position);
  return {
    line: line.number,
    column: position - line.from + 1,
  };
}

export function readCaretRect(view: EditorView): EditorCaretRect {
  const head = view.state.selection.main.head;
  const selection = toLineColumn(view, head);
  const coordinates = view.coordsAtPos(head);

  if (!coordinates) {
    return {
      ...selection,
      top: 72,
      left: 240,
      bottom: 96,
      right: 241,
      measured: false,
    };
  }

  return {
    ...selection,
    top: coordinates.top,
    left: coordinates.left,
    bottom: coordinates.bottom,
    right: coordinates.right,
    measured: true,
  };
}

function isDefinitionTokenChar(character: string) {
  return /^[A-Za-z0-9_$@]$/.test(character);
}

export function resolveDefinitionTokenRange(view: EditorView, position: number): DefinitionHoverRange | null {
  const documentLength = view.state.doc.length;
  const clampedPosition = Math.max(0, Math.min(position, documentLength));
  const characterAt = (index: number) => view.state.doc.sliceString(index, index + 1);

  let tokenPosition = clampedPosition;
  if (!isDefinitionTokenChar(characterAt(tokenPosition))) {
    tokenPosition = clampedPosition - 1;
  }

  if (tokenPosition < 0 || !isDefinitionTokenChar(characterAt(tokenPosition))) {
    return null;
  }

  let from = tokenPosition;
  while (from > 0 && isDefinitionTokenChar(characterAt(from - 1))) {
    from -= 1;
  }

  let to = tokenPosition + 1;
  while (to < documentLength && isDefinitionTokenChar(characterAt(to))) {
    to += 1;
  }

  return from < to ? { from, to } : null;
}

function updateDefinitionHoverDecoration(view: EditorView, range: DefinitionHoverRange | null) {
  view.dispatch({
    effects: setDefinitionHoverEffect.of(range),
  });
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

export function createDefinitionHoverHandler(
  onDefinitionHoverChange: (state: DefinitionHoverState) => void,
) {
  return EditorView.domEventHandlers({
    mousemove(event, view) {
      if (!(event.ctrlKey || event.metaKey)) {
        updateDefinitionHoverDecoration(view, null);
        onDefinitionHoverChange({ active: false });
        return false;
      }

      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position == null) {
        updateDefinitionHoverDecoration(view, null);
        onDefinitionHoverChange({ active: false });
        return false;
      }

      const range = resolveDefinitionTokenRange(view, position);
      if (!range) {
        updateDefinitionHoverDecoration(view, null);
        onDefinitionHoverChange({ active: false });
        return false;
      }

      updateDefinitionHoverDecoration(view, range);

      onDefinitionHoverChange({
        active: true,
        selection: toLineColumn(view, position),
        from: range.from,
        to: range.to,
      });
      return false;
    },
    mouseleave(_event, view) {
      updateDefinitionHoverDecoration(view, null);
      onDefinitionHoverChange({ active: false });
      return false;
    },
  });
}

export function createTypingCompletionTriggerListener(
  onTypingCompletionTrigger: (selection: EditorLineColumn) => void,
) {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!update.docChanged) {
      return;
    }

    let shouldTrigger = false;
    update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      if (shouldTrigger) {
        return;
      }
      const insertedText = inserted.toString();
      if (/[A-Za-z0-9_$@]$/.test(insertedText) && !/\s/.test(insertedText)) {
        shouldTrigger = true;
      }
    });

    if (!shouldTrigger) {
      return;
    }

    onTypingCompletionTrigger(toLineColumn(update.view, update.state.selection.main.head));
  });
}
