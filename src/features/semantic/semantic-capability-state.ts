import type { SemanticState } from "@/features/semantic/semantic-store";

export type SemanticApplyState = "idle" | "applying" | "applied" | "failed";

export type SemanticCapabilityStatus =
  | "applying"
  | "failed"
  | "semantic"
  | "fallback"
  | "unavailable";

export type SemanticCapabilityState = {
  status: SemanticCapabilityStatus;
  semanticNavigation: boolean;
  semanticCompletion: boolean;
  localFallback: boolean;
  message: string;
};

export function describeSemanticCapabilities(
  semanticState: SemanticState,
  applyState: SemanticApplyState,
): SemanticCapabilityState {
  if (applyState === "applying") {
    return {
      status: "applying",
      semanticNavigation: false,
      semanticCompletion: false,
      localFallback: false,
      message: "SDK settings are still applying",
    };
  }

  if (applyState === "failed") {
    return {
      status: "failed",
      semanticNavigation: false,
      semanticCompletion: false,
      localFallback: true,
      message: "SDK settings apply failed",
    };
  }

  if (semanticState.mode === "semantic") {
    return {
      status: "semantic",
      semanticNavigation: true,
      semanticCompletion: true,
      localFallback: true,
      message: semanticState.detail,
    };
  }

  if (semanticState.mode === "fallback") {
    return {
      status: "fallback",
      semanticNavigation: false,
      semanticCompletion: false,
      localFallback: true,
      message: semanticState.detail,
    };
  }

  return {
    status: "unavailable",
    semanticNavigation: false,
    semanticCompletion: false,
    localFallback: false,
    message: semanticState.detail,
  };
}

export function formatSemanticCapabilityLabel(capability: SemanticCapabilityState) {
  if (capability.status === "applying") {
    return "SDK: applying";
  }

  if (capability.status === "failed") {
    return "SDK: failed";
  }

  if (capability.status === "semantic") {
    return "SDK: semantic";
  }

  if (capability.status === "fallback") {
    return "SDK: fallback";
  }

  return "SDK: unavailable";
}
