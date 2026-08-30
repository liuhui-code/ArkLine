import {
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
  const startedAt = await performTimedSemanticGesture(
    driver,
    "definition",
    () => driver.modifierClickAt(location.x, location.y),
  );
  try {
    await waitForActiveTab(driver, target.target.title, TARGET_TIMEOUT_MS);
    const rendered = await waitForEditorTarget(
      driver,
      target.target.editorNeedle,
      TARGET_TIMEOUT_MS,
    );
    const latencyMs = Math.max(0, rendered.at - startedAt);
    samples.push(latencyMs);
    evidence.push({
      kind: "definition",
      sourceTitle: target.source.title,
      token: target.token,
      targetTitle: target.target.title,
      targetNeedle: target.target.editorNeedle,
      latencyMs,
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
  const caret = await driver.executeAsync(
    EDITOR_CARET_READINESS_SCRIPT,
    [target.lineNeedle, target.cursorAfter, 1_500],
    2_500,
  );
  if (!caret?.matched) {
    counters.completionMissCount += 1;
    throw new Error(`Member completion caret did not match: ${JSON.stringify(caret)}`);
  }
  const trigger = target.trigger ?? "manual";
  const startedAt = await performTimedSemanticGesture(
    driver,
    trigger === "typing" ? "completionTyping" : "completion",
    () => driver.keyChord(trigger === "typing"
      ? ["."]
      : [WEBDRIVER_KEYS.control, " "]),
  );
  const expectedItems = target.expectedItems ?? target.expectedLabels;
  const completion = await driver.executeAsync(
    COMPLETION_READINESS_SCRIPT,
    [expectedItems, TARGET_TIMEOUT_MS, target.forbiddenLabels ?? []],
    TARGET_TIMEOUT_MS + 1_000,
  );
  if (!completion?.matched) {
    counters.completionMissCount += 1;
    throw new Error(`Member completion did not match: ${JSON.stringify(completion)}`);
  }
  const latencyMs = Math.max(0, completion.at - startedAt);
  samples.push(latencyMs);
  let acceptedLine = null;
  let restoredLine = null;
  if (target.accept) {
    await driver.typeText(target.accept.prefix);
    const filtered = await driver.executeAsync(
      COMPLETION_READINESS_SCRIPT,
      [
        [target.accept.item],
        1_500,
        target.forbiddenLabels ?? [],
        target.accept.item,
      ],
      2_500,
    );
    if (!filtered?.matched) {
      counters.completionMissCount += 1;
      throw new Error(`Filtered member completion did not match: ${JSON.stringify(filtered)}`);
    }
    await driver.keyChord([WEBDRIVER_KEYS.enter]);
    const applied = await driver.executeAsync(
      EDITOR_LINE_READINESS_SCRIPT,
      [target.accept.expectedLine, 1_500],
      2_500,
    );
    if (!applied?.matched) {
      counters.completionMissCount += 1;
      throw new Error(`Accepted member completion was not applied: ${JSON.stringify(applied)}`);
    }
    acceptedLine = target.accept.expectedLine;
    for (let undoAttempt = 0; undoAttempt < 4; undoAttempt += 1) {
      await driver.keyChord([WEBDRIVER_KEYS.control, "z"]);
      const restored = await driver.executeAsync(
        EDITOR_LINE_READINESS_SCRIPT,
        [target.accept.restoreLine, 250, true],
        750,
      );
      if (restored?.matched) {
        restoredLine = target.accept.restoreLine;
        break;
      }
    }
    if (!restoredLine) {
      counters.completionMissCount += 1;
      throw new Error(`Accepted member completion was not restored: ${target.accept.restoreLine}`);
    }
  } else {
    await driver.keyChord([WEBDRIVER_KEYS.escape]);
  }
  evidence.push({
    kind: "completion",
    sourceTitle: target.source.title,
    lineNeedle: target.lineNeedle,
    trigger,
    expectedItems,
    labels: completion.labels,
    items: completion.items,
    latencyMs,
    acceptedLine,
    restoredLine,
    capturedAt: Date.now(),
  });
}

export async function warmSemanticInteractions(driver, scenario, counters, evidence) {
  const samples = [];
  for (const definitionTarget of scenario?.definitionTargets ?? []) {
    await exerciseDefinitionNavigation(driver, definitionTarget, samples, counters, evidence);
  }
  for (const completionTarget of scenario?.completionTargets ?? []) {
    await exerciseMemberCompletion(driver, completionTarget, samples, counters, evidence);
  }
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

async function performTimedSemanticGesture(driver, gesture, perform) {
  await driver.execute(INSTALL_SEMANTIC_GESTURE_CLOCK_SCRIPT, [gesture]);
  await perform();
  const startedAt = await driver.execute(READ_SEMANTIC_GESTURE_CLOCK_SCRIPT, [gesture]);
  if (!Number.isFinite(startedAt)) {
    throw new Error(`Renderer did not observe the ${gesture} input gesture`);
  }
  return startedAt;
}

const INSTALL_SEMANTIC_GESTURE_CLOCK_SCRIPT = `
  const gesture = arguments[0];
  const automation = window.__arklineAutomation ||= {};
  const starts = automation.semanticGestureStarts ||= {};
  starts[gesture] = null;
  const eventName = gesture === "definition" ? "mousedown" : "keydown";
  const listenerKey = gesture + "GestureClockListener";
  const previous = automation[listenerKey];
  if (previous) document.removeEventListener(eventName, previous, true);
  const listener = (event) => {
    const matched = gesture === "definition"
      ? event.ctrlKey && event.button === 0
      : gesture === "completionTyping"
        ? !event.ctrlKey && event.key === "."
        : event.ctrlKey && (event.key === " " || event.code === "Space");
    if (!matched) return;
    starts[gesture] = performance.now();
    document.removeEventListener(eventName, listener, true);
    automation[listenerKey] = null;
  };
  automation[listenerKey] = listener;
  document.addEventListener(eventName, listener, true);
  return true;
`;

const READ_SEMANTIC_GESTURE_CLOCK_SCRIPT = `
  const starts = window.__arklineAutomation?.semanticGestureStarts;
  return starts?.[arguments[0]] ?? null;
`;

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

export const EDITOR_CARET_READINESS_SCRIPT = `
  const lineNeedle = arguments[0];
  const cursorAfter = arguments[1];
  const timeoutMs = arguments[2];
  const done = arguments[arguments.length - 1];
  let poll;
  let timer;
  let finished = false;
  let latest = { matched: false, reason: "selection-unavailable" };
  const finish = (value) => {
    if (finished) return;
    finished = true;
    clearInterval(poll);
    clearTimeout(timer);
    done(value);
  };
  const inspect = () => {
    const editor = document.querySelector('[aria-label="Editor Content"]');
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    if (!editor || !anchor || selection.rangeCount === 0) return;
    const anchorElement = anchor.nodeType === Node.ELEMENT_NODE
      ? anchor
      : anchor.parentElement;
    const line = anchorElement?.closest?.('.cm-line');
    if (!line || !editor.contains(line)) return;
    const range = document.createRange();
    try {
      range.setStart(line, 0);
      range.setEnd(anchor, selection.anchorOffset);
    } catch {
      return;
    }
    const lineText = line.textContent || "";
    const textBeforeCursor = range.toString();
    latest = {
      matched: lineText.includes(lineNeedle) && textBeforeCursor.endsWith(cursorAfter),
      focused: document.activeElement === editor,
      lineText,
      textBeforeCursor,
      column: textBeforeCursor.length + 1,
      at: performance.now()
    };
    if (latest.matched) finish(latest);
  };
  poll = setInterval(inspect, 25);
  timer = setTimeout(() => finish({ ...latest, timeout: true }), timeoutMs);
  inspect();
`;

export const EDITOR_LINE_READINESS_SCRIPT = `
  const expectedNeedle = arguments[0];
  const timeoutMs = arguments[1];
  const exactMatch = arguments[2] === true;
  const done = arguments[arguments.length - 1];
  let observer;
  let timer;
  let finished = false;
  let lastLines = [];
  const finish = (value) => {
    if (finished) return;
    finished = true;
    observer?.disconnect();
    clearTimeout(timer);
    done(value);
  };
  const inspect = () => {
    const editor = document.querySelector('[aria-label="Editor Content"]');
    const lines = [...(editor?.querySelectorAll('.cm-line') || [])];
    lastLines = lines.map((candidate) => candidate.textContent || "");
    const line = lines
      .find((candidate) => {
        const lineText = candidate.textContent || "";
        return exactMatch
          ? lineText.trim() === expectedNeedle.trim()
          : lineText.includes(expectedNeedle);
      });
    if (line) finish({
      matched: true,
      lineText: line.textContent || "",
      at: performance.now()
    });
  };
  observer = new MutationObserver(inspect);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  timer = setTimeout(() => finish({
    matched: false,
    expectedNeedle,
    lines: lastLines,
    timeout: true
  }), timeoutMs);
  inspect();
`;

export const COMPLETION_READINESS_SCRIPT = `
  const expectedItems = arguments[0];
  const timeoutMs = arguments[1];
  const forbiddenLabels = arguments[2];
  const requiredSelectedItem = arguments.length > 4 ? arguments[3] : null;
  const done = arguments[arguments.length - 1];
  let observer;
  let timer;
  let finished = false;
  let lastItems = [];
  let lastSelectedItem = null;
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
    const items = [...list.querySelectorAll('.cm-completionLabel, .completion-popup__label')]
      .map((labelElement) => {
        const label = (labelElement.textContent || "").trim();
        const option = labelElement.closest('li, [role="option"], .cm-completion, .completion-popup__item')
          || labelElement.parentElement;
        const icon = option?.querySelector('[class*="cm-completionIcon-"]');
        const iconKind = [...(icon?.classList || [])]
          .find((className) => className.startsWith('cm-completionIcon-'))
          ?.slice('cm-completionIcon-'.length);
        const legacyKind = (option?.querySelector('.completion-popup__kind')?.textContent || "")
          .trim()
          .toLowerCase();
        const selected = option?.getAttribute('aria-selected') === 'true'
          || option?.id === list.getAttribute('aria-activedescendant')
          || option?.classList.contains('completion-popup__option--selected');
        return { label, kind: iconKind || legacyKind || null, selected };
      })
      .filter((item) => Boolean(item.label));
    lastItems = items;
    lastSelectedItem = items.find((item) => item.selected) || null;
    const labels = items.map((item) => item.label);
    const normalize = (label) => label.endsWith("()") ? label.slice(0, -2) : label;
    const normalizedLabels = labels.map(normalize);
    const forbidden = forbiddenLabels.filter((label) => normalizedLabels.includes(normalize(label)));
    if (forbidden.length > 0) {
      finish({ matched: false, labels, items, forbidden, at: performance.now() });
      return;
    }
    const expected = expectedItems.map((item) => typeof item === "string"
      ? { label: item, kind: null }
      : item);
    const matched = expected.every((expectedItem) => items.some((item) => (
      normalize(item.label) === normalize(expectedItem.label)
      && (!expectedItem.kind || item.kind === expectedItem.kind)
    )));
    const selectedMatched = !requiredSelectedItem || (lastSelectedItem && (
      normalize(lastSelectedItem.label) === normalize(requiredSelectedItem.label)
      && (!requiredSelectedItem.kind || lastSelectedItem.kind === requiredSelectedItem.kind)
    ));
    if (matched && selectedMatched) {
      finish({
        matched: true,
        labels,
        items,
        selectedItem: lastSelectedItem,
        at: performance.now()
      });
    }
  };
  observer = new MutationObserver(inspect);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  timer = setTimeout(() => finish({
    matched: false,
    labels: lastItems.map((item) => item.label),
    items: lastItems,
    selectedItem: lastSelectedItem,
    requiredSelectedItem,
    timeout: true
  }), timeoutMs);
  inspect();
`;
