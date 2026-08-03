import { describe, expect, it } from "vitest";
import {
  isCoreWorkspaceIndexReady,
} from "../../scripts/packaged-soak-readiness.mjs";

describe("packaged soak index readiness", () => {
  it("accepts complete workspace freshness when optional layers stay partial", () => {
    expect(isCoreWorkspaceIndexReady({
      status: "partial",
      discoveryStatus: "ready",
      discoveredFileCount: 1_001,
      fileCount: 1_001,
      contentLineCount: 68_270,
      freshnessLayers: [
        {
          layer: "content",
          readyCount: 1_001,
          missingCount: 0,
          staleCount: 0,
        },
      ],
      layerReadiness: {
        layers: [
          {
            layer: "content",
            indexedCount: 768,
            workspaceStatus: "partial",
          },
          {
            layer: "sdkApi",
            indexedCount: 0,
            workspaceStatus: "missing",
          },
        ],
      },
    })).toBe(true);
  });

  it("rejects incomplete or stale content freshness", () => {
    const base = {
      status: "partial",
      discoveryStatus: "ready",
      discoveredFileCount: 1_001,
      fileCount: 1_001,
      contentLineCount: 68_270,
    };

    expect(isCoreWorkspaceIndexReady({
      ...base,
      freshnessLayers: [{
        layer: "content",
        readyCount: 1_000,
        missingCount: 1,
        staleCount: 0,
      }],
    })).toBe(false);
    expect(isCoreWorkspaceIndexReady({
      ...base,
      freshnessLayers: [{
        layer: "content",
        readyCount: 1_001,
        missingCount: 0,
        staleCount: 1,
      }],
    })).toBe(false);
  });
});
