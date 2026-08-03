import { EditorState } from "@codemirror/state";
import type { Transaction } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { createCodeMirrorCompletionSources } from "@/editor/codemirror-completion-source";
import { createVersionCheckedCompletionTransaction } from "@/editor/completion-transaction";
import { createCodeMirrorSignatureHelpExtension, readSignatureContext } from "@/editor/codemirror-signature-help";
import { createCodeMirrorCompletionResultReporter } from "@/components/layout/codemirror-completion-broker";
import type { LanguageCompletionItem } from "@/features/workspace/workspace-api";

describe("CodeMirror completion sources", () => {
  it("keeps both immediate and broker completion disabled behind one availability gate", async () => {
    const broker = vi.fn(async () => [{ label: "build", detail: "method", kind: "method" }]);
    const sources = createCodeMirrorCompletionSources(
      () => "/workspace/Main.ets",
      broker,
      undefined,
      () => false,
    );
    const context = new CompletionContext(EditorState.create({ doc: "pub" }), 3, true);

    await expect(Promise.all(sources.map((source) => source(context)))).resolves.toEqual([null, null]);
    expect(broker).not.toHaveBeenCalled();
  });

  it("returns immediate ArkTS keywords with a reusable validFor range", async () => {
    const state = EditorState.create({ doc: "const pub" });
    const context = new CompletionContext(state, state.doc.length, false);
    const [source] = createCodeMirrorCompletionSources(() => "/workspace/Main.ets", async () => []);

    const result = await source(context);

    expect(result).not.toBeNull();
    expect(result?.from).toBe(6);
    expect(result?.validFor).toEqual(/^\.?[A-Za-z0-9_$]*$/);
    expect(result?.options.map((item) => item.label)).toContain("public");
  });

  it("derives completion context without materializing the full document", async () => {
    const state = EditorState.create({ doc: `${"const padding = 1;\n".repeat(8_000)}const pub` });
    const context = new CompletionContext(state, state.doc.length, false);
    const toString = vi.spyOn(state.doc, "toString");
    const [source] = createCodeMirrorCompletionSources(() => "/workspace/Main.ets", async () => []);

    const result = await source(context);

    expect(result?.options.map((item) => item.label)).toContain("public");
    expect(toString).not.toHaveBeenCalled();
    toString.mockRestore();
  });

  it("queries the broker after member access and maps commit metadata", async () => {
    const state = EditorState.create({ doc: "this." });
    const context = new CompletionContext(state, state.doc.length, false);
    const broker = vi.fn(async () => [{
      label: "width",
      detail: "property: number",
      kind: "property",
      insertText: "width",
      documentation: "Current width",
      commitCharacters: ["."],
      replacementRange: {
        startLine: 1,
        startColumn: 5,
        endLine: 1,
        endColumn: 6,
      },
    }]);
    const [, source] = createCodeMirrorCompletionSources(() => "/workspace/Main.ets", broker);

    const result = await source(context);

    expect(broker).toHaveBeenCalledWith(expect.objectContaining({
      path: "/workspace/Main.ets",
      line: 1,
      column: 6,
      query: "",
    }));
    expect(result?.from).toBe(4);
    const option = result?.options[0];
    expect(option).toMatchObject({ label: "width", type: "property", apply: "width" });
    expect(option?.info).toEqual(expect.any(Function));
    expect(option?.commitCharacters).toEqual(["."]);
  });

  it("uses provider filter text while preserving the visible label and insertion", async () => {
    const state = EditorState.create({ doc: "wi" });
    const [, source] = createCodeMirrorCompletionSources(() => "/workspace/Main.ets", async () => [{
      label: "setWidth(value)",
      filterText: "width",
      detail: "ArkUI attribute",
      kind: "method",
    }]);

    const result = await source(new CompletionContext(state, state.doc.length, true));

    expect(result?.options[0]).toMatchObject({
      label: "width",
      displayLabel: "setWidth(value)",
      apply: "setWidth(value)",
    });
  });

  it("keeps snippet placeholders as native tab stops", async () => {
    const state = EditorState.create({ doc: "width" });
    const context = new CompletionContext(state, state.doc.length, true);
    const [, source] = createCodeMirrorCompletionSources(() => "/workspace/Main.ets", async () => [{
      label: "width",
      detail: "width(value: Length): T",
      kind: "method",
      insertText: "width(${1:value})${0}",
      commitCharacters: ["("],
    }]);

    const result = await source(context);
    const option = result?.options[0];
    let transaction: Transaction | undefined;
    if (option && typeof option.apply === "function") {
      option.apply(
        {
          state,
          dispatch: ((next: Transaction | readonly Transaction[]) => {
            transaction = Array.isArray(next) ? next[0] : next;
          }) as EditorView["dispatch"],
        } as unknown as EditorView,
        option,
        0,
        5,
      );
    }

    expect(typeof option?.apply).toBe("function");
    expect(transaction?.newDoc.toString()).toBe("width(value)");
    expect(transaction?.selection?.main.from).toBe(6);
  });

  it("reuses stable completion identities across async refreshes", async () => {
    const broker = vi.fn(async () => [{
      label: "width",
      detail: "property: number",
      kind: "property",
      source: "sdk" as const,
      data: { symbolId: "sdk:width" },
    }]);
    const [, source] = createCodeMirrorCompletionSources(() => "/workspace/Main.ets", broker);
    const firstState = EditorState.create({ doc: "this.w" });
    const secondState = EditorState.create({ doc: "this.w" });

    const first = await source(new CompletionContext(firstState, firstState.doc.length, true));
    const second = await source(new CompletionContext(secondState, secondState.doc.length, true));

    expect(second?.options[0]).toBe(first?.options[0]);
  });

  it("applies the completion and import edit as one version-checked transaction", () => {
    const state = EditorState.create({ doc: "const wi\n" });
    const transaction = createVersionCheckedCompletionTransaction({
      state,
      expectedDocument: state.doc,
      from: 6,
      to: 8,
      insertText: "width",
      additionalChanges: [{ from: 0, to: 0, insert: "import { Width } from '@sdk';\n" }],
    });

    expect(transaction).not.toBeNull();
    const next = state.update(transaction!);
    expect(next.newDoc.toString()).toBe("import { Width } from '@sdk';\nconst width\n");
    expect(next.newSelection.main.from).toBe(41);
  });

  it("rejects stale or overlapping completion transactions", () => {
    const state = EditorState.create({ doc: "const wi" });
    const stale = EditorState.create({ doc: "const wi" });
    expect(createVersionCheckedCompletionTransaction({
      state: stale,
      expectedDocument: state.doc,
      from: 6,
      to: 8,
      insertText: "width",
    })).toBeNull();
    expect(createVersionCheckedCompletionTransaction({
      state,
      expectedDocument: state.doc,
      from: 6,
      to: 8,
      insertText: "width",
      additionalChanges: [{ from: 7, to: 7, insert: "!" }],
    })).toBeNull();
  });

  it("resolves completion details lazily and only once", async () => {
    const resolver = vi.fn(async (item: { label: string }) => ({
      ...item,
      detail: "resolved detail",
      kind: "property",
      documentation: "Resolved documentation",
    }));
    const [, source] = createCodeMirrorCompletionSources(
      () => "/workspace/Main.ets",
      async () => [{ label: "width", detail: "property", kind: "property" }],
      resolver,
    );
    const state = EditorState.create({ doc: "this.w" });
    const result = await source(new CompletionContext(state, state.doc.length, true));
    const option = result?.options[0];

    expect(resolver).not.toHaveBeenCalled();
    if (!option || typeof option.info !== "function") {
      throw new Error("expected lazy completion info resolver");
    }
    const firstInfo = await option.info(option);
    const secondInfo = await option.info(option);

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(firstInfo && "textContent" in firstInfo ? firstInfo.textContent : "").toContain("Resolved documentation");
    expect(secondInfo && "textContent" in secondInfo ? secondInfo.textContent : "").toContain("Resolved documentation");
  });

  it("applies a resolved same-file import edit with the completion in one transaction", async () => {
    const state = EditorState.create({ doc: "const Wid\n" });
    let transaction: Transaction | undefined;
    const resolver = vi.fn(async (item: { label: string }) => ({
      ...item,
      detail: "class Widget",
      kind: "class",
      additionalTextEdits: [{
        path: "C:\\workspace\\Main.ets",
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        newText: "import { Widget } from './Widget';\n",
        expectedVersion: 7,
      }],
    }));
    const [, source] = createCodeMirrorCompletionSources(
      () => "C:/workspace/Main.ets",
      async () => [{
        label: "Widget",
        detail: "class",
        kind: "class",
        data: { provider: "typescript", documentVersion: 7 },
      }],
      resolver,
    );
    const result = await source(new CompletionContext(state, 9, true));
    const option = result?.options[0];
    if (!option || typeof option.apply !== "function") {
      throw new Error("expected resolved completion apply function");
    }

    option.apply({
      state,
      dispatch: ((next: Transaction | readonly Transaction[]) => {
        const value = Array.isArray(next) ? next[0] : next;
        transaction = "newDoc" in value ? value : state.update(value);
      }) as EditorView["dispatch"],
    } as unknown as EditorView, option, 6, 9);
    await vi.waitFor(() => expect(transaction).toBeDefined());

    expect(transaction?.newDoc.toString()).toBe("import { Widget } from './Widget';\nconst Widget\n");
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("drops a resolved completion after the editor document changes", async () => {
    const state = EditorState.create({ doc: "const Wid" });
    let currentState = state;
    let dispatched = false;
    let finishResolve: ((item: LanguageCompletionItem) => void) | undefined;
    const resolver = vi.fn((item: LanguageCompletionItem) => new Promise<LanguageCompletionItem>((resolve) => {
      finishResolve = resolve;
    }));
    const [, source] = createCodeMirrorCompletionSources(
      () => "/workspace/Main.ets",
      async () => [{
        label: "Widget",
        detail: "class",
        kind: "class",
        data: { provider: "typescript", documentVersion: 3 },
      }],
      resolver,
    );
    const result = await source(new CompletionContext(state, state.doc.length, true));
    const option = result?.options[0];
    if (!option || typeof option.apply !== "function") throw new Error("expected resolved apply");
    const view = {
      get state() { return currentState; },
      dispatch() { dispatched = true; },
    } as unknown as EditorView;

    option.apply(view, option, 6, 9);
    currentState = state.update({ changes: { from: 0, insert: "// changed\n" } }).state;
    finishResolve?.({ label: "Widget", detail: "class", kind: "class" });
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatched).toBe(false);
  });

  it("finds the active call and argument while ignoring nested literals and comments", () => {
    const content = "foo(\"a,b\", nested(1, 2), /* comma, */ value, ";
    const context = readSignatureContext(content, content.length);

    expect(context).toEqual({ open: 3, argumentIndex: 3 });
    expect(readSignatureContext("const value = (a + b)", 21)).toBeNull();
  });

  it("does not dispatch signature state while CodeMirror is updating", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: "foo(",
        extensions: [createCodeMirrorSignatureHelpExtension(() => "/workspace/Main.ets", async () => null)],
      }),
      parent: host,
    });

    view.dispatch({ changes: { from: 4, insert: ")" } });
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
    view.destroy();
    consoleError.mockRestore();
  });

  it("drops a signature response after the document moves on", async () => {
    let resolveBroker: ((value: { signatures: [{ label: string }] }) => void) | undefined;
    const broker = vi.fn(() => new Promise<{ signatures: [{ label: string }] }>((resolve) => {
      resolveBroker = resolve;
    }));
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: "foo(",
        extensions: [createCodeMirrorSignatureHelpExtension(() => "/workspace/Main.ets", broker)],
      }),
      parent: host,
    });

    view.dispatch({ selection: { anchor: 4 } });
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(broker).toHaveBeenCalledTimes(1);
    view.dispatch({ changes: { from: 4, insert: "value" } });
    resolveBroker?.({ signatures: [{ label: "foo(value: string)" }] });
    await Promise.resolve();
    await Promise.resolve();

    expect(host.querySelector(".cm-arkline-signature-help")).toBeNull();
    view.destroy();
  });
});

describe("CodeMirror completion reporting", () => {
  it("reports explainable empty results without introducing a second UI state machine", () => {
    const onStatusChange = vi.fn();
    const recordExplain = vi.fn();
    const reporter = createCodeMirrorCompletionResultReporter(onStatusChange, recordExplain);

    reporter({
      path: "/workspace/Main.ets",
      document: EditorState.create({ doc: "bu" }).doc,
      lineText: "bu",
      line: 1,
      column: 3,
      explicit: true,
      query: "bu",
      replacePrefix: "bu",
    }, {
      items: [],
      explain: ["reason:Current file index is stale"],
    });

    expect(onStatusChange).toHaveBeenCalledWith("Current file index is stale");
    expect(recordExplain).toHaveBeenCalledWith(expect.objectContaining({
      kind: "completion",
      query: "bu",
      message: "Current file index is stale",
    }));
  });
});
