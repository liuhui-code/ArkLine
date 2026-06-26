import {
  describeSemanticCapabilities,
  type SemanticApplyState,
} from "@/features/semantic/semantic-capability-state";
import type { SemanticState } from "@/features/semantic/semantic-store";

describe("semantic capability state", () => {
  const semanticReady: SemanticState = {
    provider: "arkts-language-server",
    mode: "semantic",
    detail: "ArkTS language service is running",
  };

  const fallbackReady: SemanticState = {
    provider: "fallback",
    mode: "fallback",
    detail: "Using local symbol fallback",
  };

  it("blocks semantic actions while SDK settings are applying", () => {
    const applying: SemanticApplyState = "applying";

    expect(describeSemanticCapabilities(semanticReady, applying)).toMatchObject({
      status: "applying",
      semanticNavigation: false,
      semanticCompletion: false,
      localFallback: false,
      message: "SDK settings are still applying",
    });
  });

  it("distinguishes semantic readiness from fallback-only readiness", () => {
    expect(describeSemanticCapabilities(semanticReady, "idle")).toMatchObject({
      status: "semantic",
      semanticNavigation: true,
      semanticCompletion: true,
      localFallback: true,
    });

    expect(describeSemanticCapabilities(fallbackReady, "idle")).toMatchObject({
      status: "fallback",
      semanticNavigation: false,
      semanticCompletion: false,
      localFallback: true,
    });
  });

  it("keeps failed apply state visible and disables semantic actions", () => {
    expect(describeSemanticCapabilities(semanticReady, "failed")).toMatchObject({
      status: "failed",
      semanticNavigation: false,
      semanticCompletion: false,
      localFallback: true,
      message: "SDK settings apply failed",
    });
  });
});
