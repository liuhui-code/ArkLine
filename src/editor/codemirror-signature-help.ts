import { StateEffect, StateField, type Text } from "@codemirror/state";
import { EditorView, showTooltip, ViewPlugin, type Tooltip, type ViewUpdate } from "@codemirror/view";

export type CodeMirrorSignatureHelpRequest = {
  path: string;
  document: Text;
  line: number;
  column: number;
  argumentIndex: number;
  triggerKind: "character" | "cursorMove";
};

export type CodeMirrorSignature = {
  label: string;
  documentation?: string;
  parameters?: Array<{ label: string; documentation?: string }>;
};

export type CodeMirrorSignatureHelp = {
  signatures: CodeMirrorSignature[];
  activeSignature?: number;
  activeParameter?: number;
};

export type CodeMirrorSignatureHelpBroker = (
  request: CodeMirrorSignatureHelpRequest,
  signal: AbortSignal,
) => Promise<CodeMirrorSignatureHelp | null>;

type SignatureHelpState = {
  position: number;
  document: Text;
  result: CodeMirrorSignatureHelp;
};

const setSignatureHelp = StateEffect.define<SignatureHelpState | null>();

export function readSignatureContext(content: string, position: number) {
  const start = Math.max(0, position - 8192);
  const stack: Array<{ open: number; argumentIndex: number }> = [];
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < position; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    if (lineComment) {
      lineComment = character !== "\n";
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if ((character === "'" || character === '"' || character === "`") && !quote) {
      quote = character;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "(") {
      stack.push({ open: index, argumentIndex: 0 });
    } else if (character === ")") {
      stack.pop();
    } else if (character === "," && stack.length > 0) {
      stack[stack.length - 1].argumentIndex += 1;
    }
  }

  const active = stack.at(-1);
  if (!active || !isCallTarget(content, active.open)) return null;
  return { open: active.open, argumentIndex: active.argumentIndex };
}

export function createCodeMirrorSignatureHelpExtension(
  path: () => string | null,
  broker: CodeMirrorSignatureHelpBroker,
) {
  const signatureHelpState = StateField.define<SignatureHelpState | null>({
    create: () => null,
    update(value, transaction) {
      let next = transaction.docChanged || transaction.selection ? null : value;
      for (const effect of transaction.effects) {
        if (effect.is(setSignatureHelp)) next = effect.value;
      }
      return next;
    },
    provide: (field) => showTooltip.from(field, (value) => {
      return value ? createSignatureTooltip(value) : null;
    }),
  });

  const plugin = ViewPlugin.fromClass(class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private controller: AbortController | null = null;
    private generation = 0;
    private disposed = false;
    private pendingEffect: SignatureHelpState | null | undefined;
    private pendingEffectGeneration: number | null = null;
    private effectScheduled = false;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate) {
      if (!update.docChanged && !update.selectionSet) return;
      const position = this.view.state.selection.main.head;
      const context = readSignatureContextFromDocument(this.view.state.doc, position);
      if (!context) {
        this.cancel();
        this.scheduleEffect(null, this.generation);
        return;
      }
      this.schedule(position, context.argumentIndex, update.docChanged ? "character" : "cursorMove");
    }

    destroy() {
      this.disposed = true;
      this.cancel();
    }

    private schedule(position: number, argumentIndex: number, triggerKind: "character" | "cursorMove") {
      this.cancel();
      const document = this.view.state.doc;
      const generation = ++this.generation;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.controller = new AbortController();
        const pathValue = path();
        if (!pathValue) return;
        const line = document.lineAt(position);
        const request: CodeMirrorSignatureHelpRequest = {
          path: pathValue,
          document,
          line: line.number,
          column: position - line.from + 1,
          argumentIndex,
          triggerKind,
        };
        void broker(request, this.controller.signal).then((result) => {
          if (!result || generation !== this.generation || this.view.state.doc !== document || this.disposed) return;
          if (this.view.state.selection.main.head !== position) return;
          this.scheduleEffect({ position, document, result }, generation);
        }).catch(() => undefined);
      }, 80);
    }

    private cancel() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.controller?.abort();
      this.controller = null;
      this.generation += 1;
      this.pendingEffect = undefined;
      this.pendingEffectGeneration = null;
    }

    private scheduleEffect(effect: SignatureHelpState | null, generation: number) {
      this.pendingEffect = effect;
      this.pendingEffectGeneration = generation;
      if (this.effectScheduled) return;
      this.effectScheduled = true;
      queueMicrotask(() => {
        this.effectScheduled = false;
        const pending = this.pendingEffect;
        const pendingGeneration = this.pendingEffectGeneration;
        this.pendingEffect = undefined;
        this.pendingEffectGeneration = null;
        if (this.disposed || pendingGeneration !== this.generation || pending === undefined) return;
        if (pending && (
          this.view.state.doc !== pending.document
          || this.view.state.selection.main.head !== pending.position
        )) return;
        this.view.dispatch({ effects: setSignatureHelp.of(pending) });
      });
    }
  });

  return [signatureHelpState, plugin];
}

function readSignatureContextFromDocument(document: Text, position: number) {
  const start = Math.max(0, position - 8192);
  const content = document.sliceString(start, position);
  const context = readSignatureContext(content, content.length);
  return context ? { ...context, open: context.open + start } : null;
}

function isCallTarget(content: string, open: number) {
  const before = content.slice(0, open).trimEnd().at(-1) ?? "";
  return /[A-Za-z0-9_$.)\]]/.test(before);
}

function createSignatureTooltip(state: SignatureHelpState): Tooltip {
  return {
    pos: state.position,
    above: true,
    arrow: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-arkline-signature-help";
      const activeSignature = state.result.signatures[state.result.activeSignature ?? 0];
      if (!activeSignature) return { dom };
      const label = document.createElement("div");
      label.className = "cm-arkline-signature-help__label";
      label.textContent = activeSignature.label;
      dom.append(label);
      const activeParameter = activeSignature.parameters?.[state.result.activeParameter ?? 0];
      if (activeParameter?.documentation || activeSignature.documentation) {
        const detail = document.createElement("div");
        detail.className = "cm-arkline-signature-help__detail";
        detail.textContent = activeParameter?.documentation ?? activeSignature.documentation ?? "";
        dom.append(detail);
      }
      return { dom };
    },
  };
}
