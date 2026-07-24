import { describe, expect, it } from "vitest";
import {
  languageExtensionForPath,
  structureExtensionForDocument,
} from "@/editor/editor-extensions";

describe("editor extension cache", () => {
  it("reuses immutable language packages across document switches", () => {
    expect(languageExtensionForPath("First.ets"))
      .toBe(languageExtensionForPath("Second.ts"));
    expect(languageExtensionForPath("First.json5"))
      .toBe(languageExtensionForPath("Second.json5"));
  });

  it("reuses immutable structure packages across document switches", () => {
    expect(structureExtensionForDocument(false))
      .toBe(structureExtensionForDocument(false));
    expect(structureExtensionForDocument(true))
      .toBe(structureExtensionForDocument(true));
  });
});
