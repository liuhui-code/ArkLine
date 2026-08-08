import { describe, expect, it, vi } from "vitest";
import {
  EDITOR_FOCUS_SNAPSHOT_SCRIPT,
  EDITOR_SCROLL_SCRIPT,
  EDITOR_TEXT_SNAPSHOT_SCRIPT,
  INPUT_BURST,
  exerciseEditorInteraction,
} from "../../scripts/packaged-soak-editor-workload.mjs";
import {
  FIXTURE_VERSION,
  renderFixtureSource,
} from "../../scripts/generate-performance-fixture.mjs";

describe("packaged editor workload", () => {
  it("versions a bounded set of generated files for real editor scrolling", () => {
    expect(FIXTURE_VERSION).toBe(2);
    expect(renderFixtureSource(0).split("\n").length).toBeGreaterThan(80);
    expect(renderFixtureSource(1_000).split("\n").length).toBeLessThan(20);
  });

  it("observes a real edit, restores it, and records a stable scroll frame", async () => {
    let textLength = 120;
    const driver = {
      execute: vi.fn(async (script: string) => {
        if (script === EDITOR_FOCUS_SNAPSHOT_SCRIPT) {
          return { present: true, focused: true, textLength, at: 10 };
        }
        if (script === EDITOR_TEXT_SNAPSHOT_SCRIPT) {
          return {
            present: true,
            textLength,
            at: textLength === 120 + INPUT_BURST.length ? 118 : 130,
          };
        }
        return 100;
      }),
      executeAsync: vi.fn(async (script: string) => {
        expect(script).toBe(EDITOR_SCROLL_SCRIPT);
        return { moved: true, durationMs: 12, before: 0, after: 320 };
      }),
      typeText: vi.fn(async (text: string) => {
        textLength += text === INPUT_BURST ? INPUT_BURST.length : -INPUT_BURST.length;
      }),
      keyChord: vi.fn(async () => {
        textLength = 120;
      }),
    };

    const result = await exerciseEditorInteraction(driver, { timeoutMs: 200 });

    expect(result).toMatchObject({
      inputVisibleMs: 18,
      deleteVisibleMs: 30,
      restored: true,
      scrollMoved: true,
      scrollFrameMs: 12,
    });
    expect(driver.typeText).toHaveBeenNthCalledWith(1, INPUT_BURST);
    expect(driver.keyChord).toHaveBeenCalledWith(["\uE009", "z"]);
  });

  it("treats typing over an active selection as a visible edit", async () => {
    const baselineLength = 120;
    const selectionLength = INPUT_BURST.length;
    let textLength = baselineLength;
    const driver = {
      execute: vi.fn(async (script: string) => {
        if (script === EDITOR_FOCUS_SNAPSHOT_SCRIPT) {
          return { present: true, focused: true, textLength, selectionLength, at: 10 };
        }
        if (script === EDITOR_TEXT_SNAPSHOT_SCRIPT) {
          return { present: true, focused: true, textLength, at: 30 };
        }
        return 20;
      }),
      executeAsync: vi.fn(async () => ({ moved: false })),
      typeText: vi.fn(async () => undefined),
      keyChord: vi.fn(async () => undefined),
    };

    await expect(exerciseEditorInteraction(driver, { timeoutMs: 20 }))
      .resolves.toMatchObject({ restored: true });
  });

  it("fails explicitly when the active CodeMirror editor is missing", async () => {
    const driver = {
      execute: vi.fn(async () => ({ present: false })),
      executeAsync: vi.fn(),
      typeText: vi.fn(),
      keyChord: vi.fn(),
    };

    await expect(exerciseEditorInteraction(driver, { timeoutMs: 20 }))
      .rejects.toThrow("Active CodeMirror editor is missing");
  });

  it("fails before typing when CodeMirror cannot receive focus", async () => {
    const driver = {
      execute: vi.fn(async () => ({ present: true, focused: false })),
      executeAsync: vi.fn(),
      typeText: vi.fn(),
      keyChord: vi.fn(),
    };

    await expect(exerciseEditorInteraction(driver, { timeoutMs: 20 }))
      .rejects.toThrow("did not receive focus");
    expect(driver.typeText).not.toHaveBeenCalled();
  });

  it("keeps a short document usable while reporting absent scroll evidence", async () => {
    let textLength = 20;
    const driver = {
      execute: vi.fn(async (script: string) => {
        if (script === EDITOR_FOCUS_SNAPSHOT_SCRIPT) {
          return { present: true, focused: true, textLength, at: 10 };
        }
        if (script === EDITOR_TEXT_SNAPSHOT_SCRIPT) {
          return {
            present: true,
            textLength,
            at: textLength === 20 + INPUT_BURST.length ? 106 : 120,
          };
        }
        return 100;
      }),
      executeAsync: vi.fn(async () => ({
        moved: false,
        durationMs: 0,
        before: 0,
        after: 0,
      })),
      typeText: vi.fn(async (text: string) => {
        textLength += text === INPUT_BURST ? INPUT_BURST.length : -INPUT_BURST.length;
      }),
      keyChord: vi.fn(async () => {
        textLength = 20;
      }),
    };

    await expect(exerciseEditorInteraction(driver, { timeoutMs: 200 }))
      .resolves.toMatchObject({ restored: true, scrollMoved: false });
  });

  it("reports the focus owner when an editor input loses focus", async () => {
    const driver = {
      execute: vi.fn(async (script: string) => {
        if (script === EDITOR_FOCUS_SNAPSHOT_SCRIPT) {
          return { present: true, focused: true, textLength: 20, at: 10 };
        }
        if (script === EDITOR_TEXT_SNAPSHOT_SCRIPT) {
          return {
            present: true,
            focused: false,
            activeElement: "button:Close",
            textLength: 20 + INPUT_BURST.length,
            at: 30,
          };
        }
        return 20;
      }),
      executeAsync: vi.fn(),
      typeText: vi.fn(),
      keyChord: vi.fn(),
    };

    await expect(exerciseEditorInteraction(driver, { timeoutMs: 20 }))
      .rejects.toThrow('Editor lost focus after input: {"present":true,"focused":false,"activeElement":"button:Close"');
  });
});
