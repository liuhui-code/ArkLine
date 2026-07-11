import { describe, expect, it } from "vitest";
import {
  LANGUAGE_QUERY_OVERSIZED_CONTENT_THRESHOLD,
  buildLanguageQuerySnapshot,
} from "@/components/layout/language-query-request-model";
import { decideLanguageQuerySync } from "@/components/layout/language-query-policy-guard";
import { LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD } from "@/editor/editor-document-budget";

describe("language query policy guard", () => {
  it("allows normal synchronous requests", () => {
    const decision = decideLanguageQuerySync(snapshot("small"));

    expect(decision).toMatchObject({
      allowSyncRequest: true,
      severity: "ok",
      label: "Sync OK",
    });
  });

  it("marks large synchronous requests as cautious", () => {
    const decision = decideLanguageQuerySync(snapshot("x".repeat(LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD)));

    expect(decision).toMatchObject({
      allowSyncRequest: true,
      severity: "caution",
      label: "Sync cautious",
    });
  });

  it("blocks oversized synchronous requests from the recommended path", () => {
    const decision = decideLanguageQuerySync(snapshot("x".repeat(LANGUAGE_QUERY_OVERSIZED_CONTENT_THRESHOLD)));

    expect(decision).toMatchObject({
      allowSyncRequest: false,
      severity: "blocked",
      label: "Avoid sync",
    });
  });
});

function snapshot(content: string) {
  return buildLanguageQuerySnapshot({
    activePath: "/workspace/Entry.ets",
    editorSelection: { line: 1, column: 1 },
    getActiveContent: () => content,
  });
}
