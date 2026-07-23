const SAMPLE_LIMIT = 4096;
const TRACKED_INTERACTION_LABELS = new Set([
  "Find in Files Query",
  "Quick Open Query",
]);

export const TELEMETRY_INSTALL_SCRIPT = `
  if (!window.__arklinePackagedSoak) {
    const supported = new Set(PerformanceObserver.supportedEntryTypes || []);
    const state = {
      capabilities: {
        eventTiming: supported.has("event"),
        longAnimationFrame: supported.has("long-animation-frame"),
        longTask: supported.has("longtask"),
        jsHeap: Boolean(performance.memory)
      },
      errors: [], eventTimings: [], frameGaps: [], longAnimationFrames: [],
      longTasks: [], frames: 0, errorCount: 0,
      eventTimingCount: 0, frameGapCount: 0, longAnimationFrameCount: 0,
      longTaskCount: 0, interactionStarts: {}, scriptAttributions: {}
    };
    const retain = (items, value, limit = ${SAMPLE_LIMIT}) => {
      if (items.length < limit) items.push(value);
    };
    const observe = (type, callback, options = {}) => {
      if (!supported.has(type)) return;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) callback(entry);
        }).observe({ type, buffered: true, ...options });
      } catch {}
    };
    observe("event", (entry) => {
      state.eventTimingCount += 1;
      retain(state.eventTimings, {
        name: entry.name,
        duration: entry.duration,
        processingStart: entry.processingStart,
        processingEnd: entry.processingEnd,
        interactionId: entry.interactionId || 0,
        targetLabel: entry.target?.getAttribute?.("aria-label") || null
      });
    }, { durationThreshold: 16 });
    observe("long-animation-frame", (entry) => {
      state.longAnimationFrameCount += 1;
      for (const script of entry.scripts || []) {
        const sourceUrl = script.sourceURL || "(unknown)";
        const sourceFunctionName = script.sourceFunctionName || "(anonymous)";
        const sourceCharPosition = script.sourceCharPosition || 0;
        const invokerType = script.invokerType || "(unknown)";
        const key = [sourceUrl, sourceFunctionName, sourceCharPosition, invokerType].join("|");
        const existing = state.scriptAttributions[key];
        if (!existing && Object.keys(state.scriptAttributions).length >= 256) continue;
        const current = existing || {
          sourceUrl, sourceFunctionName, sourceCharPosition, invokerType,
          count: 0, totalDuration: 0, maxDuration: 0
        };
        current.count += 1;
        current.totalDuration += script.duration || 0;
        current.maxDuration = Math.max(current.maxDuration, script.duration || 0);
        state.scriptAttributions[key] = current;
      }
      retain(state.longAnimationFrames, {
        duration: entry.duration,
        blockingDuration: entry.blockingDuration || 0,
        renderDuration: entry.renderStart
          ? entry.startTime + entry.duration - entry.renderStart
          : 0,
        styleAndLayoutDuration: entry.styleAndLayoutStart
          ? entry.startTime + entry.duration - entry.styleAndLayoutStart
          : 0
      });
    });
    observe("longtask", (entry) => {
      state.longTaskCount += 1;
      retain(state.longTasks, entry.duration);
    });
    const recordError = (value) => {
      state.errorCount += 1;
      retain(state.errors, String(value), 100);
    };
    addEventListener("error", (event) => recordError(event.error || event.message));
    addEventListener("unhandledrejection", (event) => recordError(event.reason));
    addEventListener("beforeinput", (event) => {
      const label = event.target?.getAttribute?.("aria-label");
      if (label) {
        state.interactionStarts["input:" + label] = performance.now();
      }
    }, true);
    addEventListener("keydown", (event) => {
      const label = event.target?.getAttribute?.("aria-label");
      if (label && event.key === "Enter") {
        state.interactionStarts["enter:" + label] = performance.now();
      }
    }, true);
    window.__arklinePackagedSoak = state;
  }
  return window.__arklinePackagedSoak.capabilities;
`;

export const TELEMETRY_SNAPSHOT_SCRIPT = `
  const state = window.__arklinePackagedSoak || {};
  return {
    capabilities: state.capabilities || {},
    errors: state.errors || [],
    eventTimings: state.eventTimings || [],
    frameGaps: state.frameGaps || [],
    longAnimationFrames: state.longAnimationFrames || [],
    longTasks: state.longTasks || [],
    frames: state.frames || 0,
    errorCount: state.errorCount || 0,
    eventTimingCount: state.eventTimingCount || 0,
    frameGapCount: state.frameGapCount || 0,
    longAnimationFrameCount: state.longAnimationFrameCount || 0,
    longTaskCount: state.longTaskCount || 0,
    scriptAttributions: Object.values(state.scriptAttributions || {}),
    renderPressure: window.__arklineRenderPressure || null,
    ipcLatencySamples: window.__arklineIpcLatencySamples || []
  };
`;

export const HEAP_SNAPSHOT_SCRIPT = `
  const memory = performance.memory;
  return memory ? {
    supported: true,
    capturedAt: Date.now(),
    usedBytes: memory.usedJSHeapSize,
    totalBytes: memory.totalJSHeapSize,
    limitBytes: memory.jsHeapSizeLimit
  } : {
    supported: false,
    capturedAt: Date.now()
  };
`;

export const INTERACTION_START_SCRIPT = `
  const state = window.__arklinePackagedSoak || {};
  return state.interactionStarts?.[arguments[0]] ?? null;
`;

export const UI_READINESS_SCRIPT = `
  const label = arguments[0];
  if (label === "activeTab") {
    const active = document.querySelector(".editor-tab--active");
    const title = active?.getAttribute("title") || "";
    return title ? { title, at: performance.now() } : null;
  }
  const selectors = {
    "Find in Files Results": {
      results: '[aria-label="Find in Files Results"]',
      query: '[aria-label="Find in Files Query"]'
    },
    "Quick Open Results": {
      results: '[aria-label="Quick Open Results"]',
      query: '[aria-label="Quick Open Query"]'
    }
  };
  const selector = selectors[label];
  if (!selector) return null;
  const results = document.querySelector(selector.results);
  const count = results?.querySelectorAll("button").length || 0;
  return count > 0 ? {
    at: performance.now(),
    count,
    query: document.querySelector(selector.query)?.value || ""
  } : null;
`;

export const STABLE_FRAME_SCRIPT = `
  const done = arguments[arguments.length - 1];
  requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now())));
`;

export const DIAGNOSTICS_SCRIPT = `
  const done = arguments[arguments.length - 1];
  const rootPath = arguments[0];
  const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
  if (!invoke) { done({ ok: false, error: "Tauri invoke unavailable" }); return; }
  Promise.all([
    invoke("inspect_workspace_index", { rootPath }),
    invoke("get_workspace_index_task_statuses", { rootPath }),
    invoke("get_workspace_index_layer_readiness", {
      rootPath,
      currentFilePath: null
    })
  ])
    .then(([value, taskStatuses, layerReadiness]) => done({
      ok: true,
      value: { ...value, taskStatuses, layerReadiness }
    }))
    .catch((error) => done({ ok: false, error: String(error) }));
`;

export function telemetryDurations(snapshot) {
  return {
    eventTimings: (snapshot.eventTimings ?? []).map((entry) => entry.duration),
    interactionTimings: interactionTimingDurations(snapshot.eventTimings ?? []),
    longAnimationFrames: (snapshot.longAnimationFrames ?? [])
      .map((entry) => entry.duration),
    longAnimationFrameBlocking: (snapshot.longAnimationFrames ?? [])
      .map((entry) => entry.blockingDuration),
  };
}

export function interactionTimingDurations(entries) {
  const interactions = new Map();
  for (const entry of entries) {
    if (
      !(entry.interactionId > 0)
      || !Number.isFinite(entry.duration)
      || !TRACKED_INTERACTION_LABELS.has(entry.targetLabel)
    ) continue;
    interactions.set(
      entry.interactionId,
      Math.max(interactions.get(entry.interactionId) ?? 0, entry.duration),
    );
  }
  return [...interactions.values()];
}
