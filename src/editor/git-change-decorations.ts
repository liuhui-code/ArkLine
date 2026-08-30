import { StateEffect, StateField, Text, type Extension } from "@codemirror/state";
import { Chunk, type DiffConfig } from "@codemirror/merge";
import {
  gutter,
  GutterMarker,
  showTooltip,
  type BlockInfo,
  type EditorView,
  type Tooltip,
} from "@codemirror/view";

export type GitChangeBaseline = {
  revision: string;
  content: string;
};

type GitChangeKind = "added" | "modified" | "deleted";

type GitChangeState = {
  baseline: Text;
  current: Text;
  chunks: readonly Chunk[];
  selectedLine: number | null;
};

const diffConfig: DiffConfig = { scanLimit: 500, timeout: 50 };
const MAX_PREVIEW_CHARACTERS = 8_192;
const PREVIEW_TAIL_CHARACTERS = 2_048;
const selectGitChange = StateEffect.define<number | null>();

class GitChangeMarker extends GutterMarker {
  constructor(
    private readonly kind: GitChangeKind,
    private readonly lineNumber: number,
    private readonly onSelect: () => void,
  ) {
    super();
  }

  eq(other: GitChangeMarker) {
    return other.kind === this.kind && other.lineNumber === this.lineNumber;
  }

  toDOM() {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `cm-git-change-marker cm-git-change-marker--${this.kind}`;
    element.setAttribute("aria-label", `Git ${this.kind} line ${this.lineNumber}`);
    element.addEventListener("click", this.onSelect);
    return element;
  }
}

export function createGitChangeGutter(baseline: GitChangeBaseline): Extension {
  const baselineText = Text.of(baseline.content.split("\n"));
  const changeState = StateField.define<GitChangeState>({
    create(state) {
      return {
        baseline: baselineText,
        current: state.doc,
        chunks: Chunk.build(baselineText, state.doc, diffConfig),
        selectedLine: null,
      };
    },
    update(value, transaction) {
      let selectedLine = value.selectedLine;
      for (const effect of transaction.effects) {
        if (effect.is(selectGitChange)) selectedLine = effect.value;
      }
      if (!transaction.docChanged) {
        return selectedLine === value.selectedLine ? value : { ...value, selectedLine };
      }
      return {
        baseline: value.baseline,
        current: transaction.state.doc,
        chunks: Chunk.updateB(
          value.chunks,
          value.baseline,
          transaction.state.doc,
          transaction.changes,
          diffConfig,
        ),
        selectedLine,
      };
    },
    provide: (field) => showTooltip.from(
      field,
      (state) => createGitChangeTooltip(state, (view) => revertSelectedChange(view, field)),
    ),
  });

  return [
    changeState,
    gutter({
      class: "cm-git-change-gutter",
      lineMarker(view, block: BlockInfo) {
        const lineNumber = view.state.doc.lineAt(block.from).number;
        const kind = changeKindAtLine(view, view.state.field(changeState).chunks, lineNumber);
        return kind
          ? new GitChangeMarker(kind, lineNumber, () => {
              view.dispatch({ effects: selectGitChange.of(lineNumber) });
            })
          : null;
      },
      lineMarkerChange(update) {
        return update.docChanged;
      },
    }),
  ];
}

function createGitChangeTooltip(
  state: GitChangeState,
  onRevert: (view: EditorView) => void,
): Tooltip | null {
  if (state.selectedLine === null) return null;
  const chunk = changeAtLine(state.current, state.chunks, state.selectedLine);
  if (!chunk) return null;

  return {
    pos: Math.min(chunk.fromB, state.current.length),
    arrow: true,
    create(view) {
      const preview = document.createElement("section");
      preview.className = "cm-git-change-preview";
      preview.setAttribute("aria-label", "Git Change Preview");

      const header = document.createElement("header");
      header.className = "cm-git-change-preview__header";
      header.textContent = `Change at line ${state.selectedLine}`;

      const close = document.createElement("button");
      close.type = "button";
      close.className = "cm-git-change-preview__close";
      close.setAttribute("aria-label", "Close Git Change Preview");
      close.textContent = "×";
      close.addEventListener("click", () => {
        view.dispatch({ effects: selectGitChange.of(null) });
      });
      header.append(close);

      const before = createPreviewSide("HEAD", state.baseline, chunk.fromA, chunk.endA);
      const after = createPreviewSide("Current", state.current, chunk.fromB, chunk.endB);
      const actions = document.createElement("footer");
      actions.className = "cm-git-change-preview__actions";
      const revert = document.createElement("button");
      revert.type = "button";
      revert.textContent = "Revert Change";
      revert.addEventListener("click", () => onRevert(view));
      actions.append(revert);
      preview.append(header, before, after, actions);
      return { dom: preview };
    },
  };
}

function revertSelectedChange(
  view: EditorView,
  field: StateField<GitChangeState>,
) {
  const state = view.state.field(field);
  if (state.selectedLine === null) return;
  const chunk = changeAtLine(state.current, state.chunks, state.selectedLine);
  if (!chunk) return;

  let insert = state.baseline.sliceString(chunk.fromA, Math.max(chunk.fromA, chunk.toA - 1));
  if (chunk.fromA !== chunk.toA && chunk.toB <= state.current.length) {
    insert += view.state.lineBreak;
  }
  view.dispatch({
    changes: {
      from: chunk.fromB,
      to: Math.min(state.current.length, chunk.toB),
      insert,
    },
    effects: selectGitChange.of(null),
    userEvent: "revert",
  });
  view.focus();
}

function createPreviewSide(label: string, text: Text, from: number, to: number) {
  const side = document.createElement("div");
  side.className = "cm-git-change-preview__side";
  const title = document.createElement("strong");
  title.textContent = label;
  const code = document.createElement("pre");
  const length = Math.max(0, to - from);
  if (length <= MAX_PREVIEW_CHARACTERS) {
    code.textContent = text.sliceString(from, to) || "(empty)";
  } else {
    const headLength = MAX_PREVIEW_CHARACTERS - PREVIEW_TAIL_CHARACTERS;
    const head = text.sliceString(from, from + headLength);
    const tail = text.sliceString(to - PREVIEW_TAIL_CHARACTERS, to);
    code.textContent = `${head}\n…\n${tail}\n\nPreview truncated (${length} characters)`;
  }
  side.append(title, code);
  return side;
}

function changeAtLine(current: Text, chunks: readonly Chunk[], lineNumber: number): Chunk | null {
  for (const chunk of chunks) {
    const firstLine = current.lineAt(Math.min(chunk.fromB, current.length)).number;
    const lastLine = chunk.fromB === chunk.toB
      ? firstLine
      : current.lineAt(Math.min(chunk.endB, current.length)).number;
    if (lineNumber >= firstLine && lineNumber <= lastLine) return chunk;
  }
  return null;
}

function changeKindAtLine(view: EditorView, chunks: readonly Chunk[], lineNumber: number): GitChangeKind | null {
  const chunk = changeAtLine(view.state.doc, chunks, lineNumber);
  return chunk
    ? chunk.fromA === chunk.toA
      ? "added"
      : chunk.fromB === chunk.toB
        ? "deleted"
        : "modified"
    : null;
}
