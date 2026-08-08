import { rendererInteractionStart } from "./packaged-soak-readiness.mjs";
import { WEBDRIVER_KEYS } from "./packaged-soak-webdriver.mjs";

const EDITOR_LABEL = "Editor Content";
export const INPUT_BURST = "queryState";

export async function exerciseEditorInteraction(
  driver,
  { timeoutMs = 3_000 } = {},
) {
  const baseline = await driver.execute(EDITOR_FOCUS_SNAPSHOT_SCRIPT);
  if (!baseline?.present || !baseline.focused) {
    throw new Error("Active CodeMirror editor is missing or did not receive focus");
  }

  const inputDispatchMs = await timed(() => driver.typeText(INPUT_BURST));
  const inputStartedAt = await rendererInteractionStart(
    driver,
    `input:${EDITOR_LABEL}`,
  );
  const edited = await waitForEditorLength(
    driver,
    baseline.textLength - (baseline.selectionLength ?? 0) + INPUT_BURST.length,
    timeoutMs,
    "Editor input did not become visible",
    (baseline.documentChangeCount ?? 0) + INPUT_BURST.length,
  );
  if (edited.focused === false) {
    throw new Error(`Editor lost focus after input: ${JSON.stringify(edited)}`);
  }

  const deleteDispatchMs = await timed(
    () => driver.keyChord([WEBDRIVER_KEYS.control, "z"]),
  );
  const deleteStartedAt = await rendererInteractionStart(
    driver,
    `input:${EDITOR_LABEL}`,
  );
  const restored = await waitForEditorLength(
    driver,
    baseline.textLength,
    timeoutMs,
    "Editor delete burst did not restore the document",
  );

  const scroll = await driver.executeAsync(
    EDITOR_SCROLL_SCRIPT,
    [],
    timeoutMs,
  );
  return {
    inputDispatchMs,
    inputVisibleMs: Math.max(0, edited.at - inputStartedAt),
    deleteDispatchMs,
    deleteVisibleMs: Math.max(0, restored.at - deleteStartedAt),
    restored: true,
    scrollMoved: Boolean(scroll?.moved),
    scrollFrameMs: scroll?.moved ? scroll.durationMs : null,
  };
}

export async function detectCrashSurface(driver, counters) {
  const text = await driver.pageText();
  if (
    text.includes("ArkLine hit a UI error")
    || text.includes("Editor crash")
    || text.includes("Restart the app window")
  ) {
    counters.crashCount += 1;
    throw new Error("Crash boundary became visible");
  }
}

async function waitForEditorLength(
  driver,
  expectedLength,
  timeoutMs,
  timeoutMessage,
  minimumDocumentChangeCount = null,
) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await driver.execute(EDITOR_TEXT_SNAPSHOT_SCRIPT);
    if (latest?.crashed) throw new Error("Editor crash boundary became visible");
    const changedEnough = minimumDocumentChangeCount != null
      && latest?.documentChangeCount >= minimumDocumentChangeCount;
    if (latest?.present && (latest.textLength === expectedLength || changedEnough)) return latest;
    await sleep(25);
  }
  throw new Error(`${timeoutMessage}: ${JSON.stringify(latest)}`);
}

async function timed(operation) {
  const startedAt = performance.now();
  await operation();
  return performance.now() - startedAt;
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

export const EDITOR_FOCUS_SNAPSHOT_SCRIPT = `
  const editor = document.querySelector('[aria-label="Editor Content"]');
  const crashText = document.body?.innerText || "";
  const crashed = crashText.includes("ArkLine hit a UI error")
    || crashText.includes("Editor crash")
    || crashText.includes("Restart the app window");
  if (!editor || crashed) return { present: false, crashed };
  editor.focus({ preventScroll: true });
  return {
    present: document.activeElement === editor,
    focused: document.activeElement === editor,
    crashed: false,
    textLength: Number.parseInt(editor.dataset.documentLength || "", 10)
      || (editor.textContent || "").length,
    selectionLength: Number.parseInt(editor.dataset.selectionLength || "", 10) || 0,
    keyDownCount: Number.parseInt(editor.dataset.keyDownCount || "", 10) || 0,
    beforeInputCount: Number.parseInt(editor.dataset.beforeInputCount || "", 10) || 0,
    documentChangeCount: Number.parseInt(editor.dataset.documentChangeCount || "", 10) || 0,
    externalReplacementCount: Number.parseInt(editor.dataset.externalReplacementCount || "", 10) || 0,
    contentEditable: editor.contentEditable,
    at: performance.now()
  };
`;

export const EDITOR_TEXT_SNAPSHOT_SCRIPT = `
  const editor = document.querySelector('[aria-label="Editor Content"]');
  const active = document.activeElement;
  const crashText = document.body?.innerText || "";
  const crashed = crashText.includes("ArkLine hit a UI error")
    || crashText.includes("Editor crash")
    || crashText.includes("Restart the app window");
  return {
    present: Boolean(editor),
    crashed,
    focused: active === editor,
    activeElement: active
      ? [active.tagName.toLowerCase(), active.getAttribute("aria-label") || active.className || ""]
          .filter(Boolean).join(":")
      : null,
    textLength: Number.parseInt(editor?.dataset.documentLength || "", 10)
      || (editor?.textContent || "").length,
    selectionLength: Number.parseInt(editor?.dataset.selectionLength || "", 10) || 0,
    keyDownCount: Number.parseInt(editor?.dataset.keyDownCount || "", 10) || 0,
    beforeInputCount: Number.parseInt(editor?.dataset.beforeInputCount || "", 10) || 0,
    documentChangeCount: Number.parseInt(editor?.dataset.documentChangeCount || "", 10) || 0,
    externalReplacementCount: Number.parseInt(editor?.dataset.externalReplacementCount || "", 10) || 0,
    contentEditable: editor?.contentEditable || null,
    at: performance.now()
  };
`;

export const EDITOR_SCROLL_SCRIPT = `
  const done = arguments[arguments.length - 1];
  const editor = document.querySelector('[aria-label="Editor Content"]');
  const scroller = editor?.closest('.cm-editor')?.querySelector('.cm-scroller');
  if (!scroller) { done({ moved: false, reason: "missing-scroller" }); return; }
  const before = scroller.scrollTop;
  const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  if (maximum <= 0) {
    done({ moved: false, reason: "short-document", before, after: before });
    return;
  }
  const startedAt = performance.now();
  const distance = Math.max(80, Math.round(scroller.clientHeight * 0.75));
  scroller.scrollTop = before >= maximum ? 0 : Math.min(maximum, before + distance);
  scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  requestAnimationFrame(() => requestAnimationFrame(() => done({
    moved: scroller.scrollTop !== before,
    before,
    after: scroller.scrollTop,
    durationMs: performance.now() - startedAt
  })));
`;
