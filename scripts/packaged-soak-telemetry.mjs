const SAMPLE_LIMIT = 4096;

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
      longTaskCount: 0
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
    let previousFrame = performance.now();
    const frame = (now) => {
      const gap = now - previousFrame;
      if (gap > 50) {
        state.frameGapCount += 1;
        retain(state.frameGaps, gap);
      }
      previousFrame = now;
      state.frames += 1;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    observe("event", (entry) => {
      state.eventTimingCount += 1;
      retain(state.eventTimings, {
        name: entry.name,
        duration: entry.duration,
        processingStart: entry.processingStart,
        processingEnd: entry.processingEnd,
        interactionId: entry.interactionId || 0
      });
    }, { durationThreshold: 16 });
    observe("long-animation-frame", (entry) => {
      state.longAnimationFrameCount += 1;
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
    longTaskCount: state.longTaskCount || 0
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

export const RENDERER_NOW_SCRIPT = "return performance.now();";

export const STABLE_FRAME_SCRIPT = `
  const done = arguments[arguments.length - 1];
  requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now())));
`;

export const DIAGNOSTICS_SCRIPT = `
  const done = arguments[arguments.length - 1];
  const rootPath = arguments[0];
  const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
  if (!invoke) { done({ ok: false, error: "Tauri invoke unavailable" }); return; }
  invoke("inspect_workspace_index", { rootPath })
    .then((value) => done({ ok: true, value }))
    .catch((error) => done({ ok: false, error: String(error) }));
`;

export function telemetryDurations(snapshot) {
  return {
    eventTimings: (snapshot.eventTimings ?? []).map((entry) => entry.duration),
    longAnimationFrames: (snapshot.longAnimationFrames ?? [])
      .map((entry) => entry.duration),
    longAnimationFrameBlocking: (snapshot.longAnimationFrames ?? [])
      .map((entry) => entry.blockingDuration),
  };
}
