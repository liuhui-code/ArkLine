import { describe, expect, it, vi } from "vitest";
import {
  COMPLETION_READINESS_SCRIPT,
  EDITOR_CARET_READINESS_SCRIPT,
  EDITOR_LINE_READINESS_SCRIPT,
  EDITOR_TEXT_TARGET_SCRIPT,
  exerciseDefinitionNavigation,
  exerciseMemberCompletion,
  warmSemanticInteractions,
} from "../../scripts/packaged-soak-semantic-workload.mjs";

describe("packaged semantic workload", () => {
  it("verifies the CodeMirror caret is after the requested receiver", async () => {
    document.body.innerHTML = `
      <div aria-label="Editor Content" contenteditable="true">
        <div class="cm-line">this.vm.aboutToAppear(hostContext);</div>
      </div>
    `;
    const editor = document.querySelector<HTMLElement>('[aria-label="Editor Content"]')!;
    const line = editor.querySelector<HTMLElement>(".cm-line")!;
    editor.focus();
    const range = document.createRange();
    range.setStart(line.firstChild!, "this.vm.".length);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    const result = await runAsyncBrowserScript(EDITOR_CARET_READINESS_SCRIPT, [
      "this.vm.aboutToAppear(hostContext);",
      "this.vm.",
      20,
    ]);

    expect(result).toEqual(expect.objectContaining({
      matched: true,
      column: 9,
      textBeforeCursor: "this.vm.",
    }));
  });

  it("reads member labels from the active CodeMirror completion list", async () => {
    document.body.innerHTML = `
      <ul aria-label="Code Completion">
        <li aria-selected="true">
          <span class="cm-completionIcon cm-completionIcon-method"></span>
          <span class="cm-completionLabel">aboutToAppear()</span>
        </li>
        <li>
          <span class="cm-completionIcon cm-completionIcon-property"></span>
          <span class="cm-completionLabel">title</span>
        </li>
      </ul>
    `;

    const result = await runAsyncBrowserScript(COMPLETION_READINESS_SCRIPT, [
      [
        { label: "aboutToAppear", kind: "method" },
        { label: "title", kind: "property" },
      ],
      20,
      [],
    ]);

    expect(result).toEqual(expect.objectContaining({
      matched: true,
      items: [
        { label: "aboutToAppear()", kind: "method", selected: true },
        { label: "title", kind: "property", selected: false },
      ],
      selectedItem: { label: "aboutToAppear()", kind: "method", selected: true },
    }));
  });

  it("reports rendered editor lines when an accepted completion is missing", async () => {
    document.body.innerHTML = `
      <div aria-label="Editor Content">
        <div class="cm-line">this.refreshPriv</div>
        <div class="cm-line">next line</div>
      </div>
    `;

    const result = await runAsyncBrowserScript(EDITOR_LINE_READINESS_SCRIPT, [
      "this.refreshPrivate()",
      20,
    ]);

    expect(result).toEqual(expect.objectContaining({
      matched: false,
      lines: ["this.refreshPriv", "next line"],
      timeout: true,
    }));
  });

  it("control-clicks a source token and verifies the rendered definition target", async () => {
    const driver = createDriver();
    const samples: number[] = [];
    const evidence: unknown[] = [];
    const counters = semanticCounters();

    await exerciseDefinitionNavigation(driver, definitionTarget(), samples, counters, evidence);

    expect(driver.modifierClickAt).toHaveBeenCalledWith(120, 240);
    expect(samples).toEqual([40]);
    expect(counters.definitionMissCount).toBe(0);
    expect(evidence).toEqual([expect.objectContaining({
      kind: "definition",
      targetTitle: "EntryViewModel.ets",
    })]);
  });

  it("positions the caret, opens completion, and verifies required member labels", async () => {
    const driver = createDriver();
    const samples: number[] = [];
    const evidence: unknown[] = [];
    const counters = semanticCounters();

    await exerciseMemberCompletion(driver, completionTarget(), samples, counters, evidence);

    expect(driver.clickAt).toHaveBeenCalledWith(160, 260);
    expect(driver.keyChord).toHaveBeenCalledWith(["\uE009", " "]);
    expect(driver.executeAsync).toHaveBeenCalledWith(
      COMPLETION_READINESS_SCRIPT,
      [["aboutToAppear", "aboutToDisappear"], 8_000, []],
      9_000,
    );
    expect(samples).toEqual([35]);
    expect(counters.completionMissCount).toBe(0);
  });

  it("opens member completion from the user's typed dot gesture", async () => {
    const driver = createDriver();
    const samples: number[] = [];
    const evidence: unknown[] = [];
    const counters = semanticCounters();

    await exerciseMemberCompletion(driver, {
      ...completionTarget(),
      lineNeedle: "this",
      cursorAfter: "this",
      trigger: "typing",
      expectedItems: [
        { label: "refreshPrivate", kind: "method" },
        { label: "refreshProtected", kind: "method" },
      ],
      accept: {
        prefix: "refreshPriv",
        item: { label: "refreshPrivate", kind: "method" },
        expectedLine: "this.refreshPrivate()",
        restoreLine: "this",
      },
    }, samples, counters, evidence);

    expect(driver.keyChord).toHaveBeenCalledWith(["."]);
    expect(driver.keyChord).not.toHaveBeenCalledWith(["\uE009", " "]);
    expect(driver.executeAsync).toHaveBeenCalledWith(
      COMPLETION_READINESS_SCRIPT,
      [[
        { label: "refreshPrivate", kind: "method" },
        { label: "refreshProtected", kind: "method" },
      ], 8_000, []],
      9_000,
    );
    expect(driver.typeText).toHaveBeenCalledWith("refreshPriv");
    expect(driver.executeAsync).toHaveBeenCalledWith(
      COMPLETION_READINESS_SCRIPT,
      [[{ label: "refreshPrivate", kind: "method" }], 1_500, [], {
        label: "refreshPrivate",
        kind: "method",
      }],
      2_500,
    );
    expect(driver.keyChord).toHaveBeenCalledWith(["\uE007"]);
    expect(driver.keyChord).toHaveBeenCalledWith(["\uE009", "z"]);
    expect(evidence).toEqual([expect.objectContaining({
      acceptedLine: "this.refreshPrivate()",
      restoredLine: "this",
    })]);
  });

  it("warms semantic definition and completion without adding performance samples", async () => {
    const driver = createDriver();
    const counters = semanticCounters();

    await warmSemanticInteractions(driver, {
      definitionTargets: [definitionTarget()],
      completionTargets: [completionTarget()],
    }, counters, []);

    expect(driver.modifierClickAt).toHaveBeenCalledTimes(1);
    expect(driver.keyChord).toHaveBeenCalledWith(["\uE009", " "]);
    expect(counters).toMatchObject({ definitionMissCount: 0, completionMissCount: 0 });
  });
});

function runAsyncBrowserScript<T>(script: string, args: unknown[]): Promise<T> {
  return new Promise((resolve) => {
    Function(script)(...args, resolve);
  });
}

function createDriver() {
  let quickOpenQuery = "";
  let activeTabTitle = "EntryPage.ets";
  const modifierClickAt = vi.fn(async () => {
    activeTabTitle = "EntryViewModel.ets";
  });
  const driver = {
    keyChord: vi.fn(async (keys: string[]) => {
      if (keys.length === 1 && keys[0] === "\uE007" && quickOpenQuery) {
        activeTabTitle = `${quickOpenQuery}.ets`;
      }
    }),
    waitForSelectorPresent: vi.fn(async () => undefined),
    typeText: vi.fn(async (value: string) => {
      quickOpenQuery = value;
    }),
    clickAt: vi.fn(async () => undefined),
    modifierClickAt,
    execute: vi.fn(async (script: string, args?: unknown[]) => {
      if (script.includes("interactionStarts")) {
        if (args?.[0] === "enter:Quick Open Query") return 100;
        throw new Error("semantic gestures must not depend on input interaction keys");
      }
      if (script.trim() === "return performance.now();") return 10;
      if (script.includes("semanticGestureStarts")) {
        return script.includes("return starts") ? 100 : true;
      }
      if (script.includes('label === "activeTab"')) {
        return { title: activeTabTitle, at: 125 };
      }
      return { phase: args?.[0], resultCount: 1 };
    }),
    executeAsync: vi.fn(async (script: string, args?: unknown[]) => {
      if (script === EDITOR_TEXT_TARGET_SCRIPT) {
        return args?.[2] == null
          ? { matched: true, x: 120, y: 240, at: 105 }
          : { matched: true, x: 160, y: 260, at: 108 };
      }
      if (script === COMPLETION_READINESS_SCRIPT) {
        const selectedItem = args?.[3] ? { ...args[3] as object, selected: true } : undefined;
        return {
          matched: true,
          labels: ["aboutToAppear", "aboutToDisappear"],
          items: selectedItem ? [selectedItem] : [],
          selectedItem,
          at: 135,
        };
      }
      if (script === EDITOR_CARET_READINESS_SCRIPT) {
        return { matched: true, column: 9, textBeforeCursor: "this.vm.", at: 109 };
      }
      if (script.includes("expectedNeedle")) return { matched: true, at: 140 };
      if (script.includes("selectors")) return { at: 110, count: 1, query: "EntryPage" };
      return { x: 160, y: 260, at: 108 };
    }),
  };
  return driver;
}

function definitionTarget() {
  return {
    source: { query: "EntryPage", title: "EntryPage.ets", editorNeedle: "struct EntryPage" },
    token: "EntryViewModel",
    occurrence: 1,
    target: { title: "EntryViewModel.ets", editorNeedle: "class EntryViewModel" },
  };
}

function completionTarget() {
  return {
    source: { query: "EntryPage", title: "EntryPage.ets", editorNeedle: "struct EntryPage" },
    lineNeedle: "this.vm.aboutToAppear(hostContext);",
    cursorAfter: "this.vm.",
    expectedLabels: ["aboutToAppear", "aboutToDisappear"],
  };
}

function semanticCounters() {
  return {
    searchMissCount: 0,
    quickOpenMissCount: 0,
    staleApplyCount: 0,
    definitionMissCount: 0,
    completionMissCount: 0,
  };
}
