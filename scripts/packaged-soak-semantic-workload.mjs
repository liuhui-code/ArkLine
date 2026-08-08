import {
  rendererClockNow,
  waitForActiveTab,
  waitForEditorTarget,
} from "./packaged-soak-readiness.mjs";
import { openQuickOpenTarget } from "./packaged-soak-search-workload.mjs";
import { WEBDRIVER_KEYS } from "./packaged-soak-webdriver.mjs";

const TARGET_TIMEOUT_MS = 8_000;

export async function exerciseDefinitionNavigation(
  driver,
  target,
  samples,
  counters,
  evidence,
) {
  await openSource(driver, target.source, counters);
  const location = await locateEditorText(
    driver,
    target.token,
    target.occurrence,
    null,
  );
  const startedAt = await rendererClockNow(driver);
  await driver.modifierClickAt(location.x, location.y);
  try {
    await waitForActiveTab(driver, target.target.title, TARGET_TIMEOUT_MS);
    const rendered = await waitForEditorTarget(
      driver,
      target.target.editorNeedle,
      TARGET_TIMEOUT_MS,
    );
    samples.push(Math.max(0, rendered.at - startedAt));
    evidence.push({
      kind: "definition",
      sourceTitle: target.source.title,
      token: target.token,
      targetTitle: target.target.title,
      targetNeedle: target.target.editorNeedle,
      capturedAt: Date.now(),
    });
  } catch (error) {
    counters.definitionMissCount += 1;
    throw error;
  }
}

export async function exerciseMemberCompletion(
  driver,
  target,
  samples,
  counters,
  evidence,
) {
  await openSource(driver, target.source, counters);
  const location = await locateEditorText(
    driver,
    target.lineNeedle,
    1,
    target.cursorAfter,
  );
  await driver.clickAt(location.x, location.y);
  const startedAt = await rendererClockNow(driver);
  await driver.keyChord([WEBDRIVER_KEYS.control, " "]);
  const completion = await driver.executeAsync(
    COMPLETION_READINESS_SCRIPT,
    [target.expectedLabels, TARGET_TIMEOUT_MS, target.forbiddenLabels ?? []],
    TARGET_TIMEOUT_MS + 1_000,
  );
  if (!completion?.matched) {
    counters.completionMissCount += 1;
    throw new Error(`Member completion did not match: ${JSON.stringify(completion)}`);
  }
  samples.push(Math.max(0, completion.at - startedAt));
  evidence.push({
    kind: "completion",
    sourceTitle: target.source.title,
    lineNeedle: target.lineNeedle,
    expectedLabels: target.expectedLabels,
    labels: completion.labels,
    capturedAt: Date.now(),
  });
  await driver.keyChord([WEBDRIVER_KEYS.escape]);
}

async function openSource(driver, target, counters) {
  const opened = await openQuickOpenTarget(driver, target, [], counters, []);
  if (!opened) throw new Error(`Semantic source did not open: ${target.title}`);
}

async function locateEditorText(driver, needle, occurrence, cursorAfter) {
  const result = await driver.executeAsync(
    EDITOR_TEXT_TARGET_SCRIPT,
    [needle, occurrence, cursorAfter, TARGET_TIMEOUT_MS],
    TARGET_TIMEOUT_MS + 1_000,
  );
  if (!result?.matched) {
    throw new Error(`Editor target was not located: ${JSON.stringify(result)}`);
  }
  return result;
}

export const EDITOR_TEXT_TARGET_SCRIPT = `
  const needle = arguments[0];
  const occurrence = arguments[1];
  const cursorAfter = arguments[2];
  const timeoutMs = arguments[3];
  const done = arguments[arguments.length - 1];
  let observer;
  let timer;
  let finished = false;
  const finish = (value) => {
    if (finished) return;
    finished = true;
    observer?.disconnect();
    clearTimeout(timer);
    done(value);
  };
  const rangeForOffsets = (root, from, to) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let startNode;
    let startOffset = 0;
    let endNode;
    let endOffset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const next = offset + node.data.length;
      if (!startNode && from >= offset && from <= next) {
        startNode = node;
        startOffset = Math.min(node.data.length, from - offset);
      }
      if (to >= offset && to <= next) {
        endNode = node;
        endOffset = Math.min(node.data.length, to - offset);
        break;
      }
      offset = next;
    }
    if (!startNode || !endNode) return null;
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  };
  const inspect = () => {
    const editor = document.querySelector('[aria-label="Editor Content"]');
    const lines = [...(editor?.querySelectorAll('.cm-line') || [])];
    let seen = 0;
    for (const line of lines) {
      const text = line.textContent || "";
      let from = -1;
      let searchFrom = 0;
      while ((from = text.indexOf(needle, searchFrom)) >= 0) {
        seen += 1;
        searchFrom = from + Math.max(needle.length, 1);
        if (seen !== occurrence) continue;
        line.scrollIntoView({ block: "center" });
        const caretOffset = cursorAfter == null
          ? null
          : from + text.slice(from, from + needle.length).indexOf(cursorAfter) + cursorAfter.length;
        if (cursorAfter != null && caretOffset < from + cursorAfter.length) continue;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const range = caretOffset == null
            ? rangeForOffsets(line, from, from + needle.length)
            : rangeForOffsets(line, Math.max(0, caretOffset - 1), caretOffset);
          const rect = range?.getBoundingClientRect();
          if (!rect) return finish(null);
          finish({
            matched: true,
            x: caretOffset == null ? rect.left + rect.width / 2 : rect.right,
            y: rect.top + rect.height / 2,
            at: performance.now()
          });
        }));
        return;
      }
    }
  };
  observer = new MutationObserver(inspect);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  timer = setTimeout(() => finish({ matched: false, needle, occurrence }), timeoutMs);
  inspect();
`;

export const COMPLETION_READINESS_SCRIPT = `
  const expectedLabels = arguments[0];
  const timeoutMs = arguments[1];
  const forbiddenLabels = arguments[2];
  const done = arguments[arguments.length - 1];
  let observer;
  let timer;
  let finished = false;
  const finish = (value) => {
    if (finished) return;
    finished = true;
    observer?.disconnect();
    clearTimeout(timer);
    done(value);
  };
  const inspect = () => {
    const list = document.querySelector('[aria-label="Code Completion"]');
    if (!list) return;
    const labels = [...list.querySelectorAll('.completion-popup__label')]
      .map((item) => (item.textContent || "").trim())
      .filter(Boolean);
    const forbidden = forbiddenLabels.filter((label) => labels.includes(label));
    if (forbidden.length > 0) {
      finish({ matched: false, labels, forbidden, at: performance.now() });
      return;
    }
    if (expectedLabels.every((label) => labels.includes(label))) {
      finish({ matched: true, labels, at: performance.now() });
    }
  };
  observer = new MutationObserver(inspect);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  timer = setTimeout(() => finish({ matched: false, labels: [], timeout: true }), timeoutMs);
  inspect();
`;
