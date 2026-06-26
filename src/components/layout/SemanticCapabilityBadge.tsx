import {
  formatSemanticCapabilityLabel,
  type SemanticCapabilityState,
} from "@/features/semantic/semantic-capability-state";

type SemanticCapabilityBadgeProps = {
  capability: SemanticCapabilityState;
};

export function SemanticCapabilityBadge({ capability }: SemanticCapabilityBadgeProps) {
  return (
    <span
      aria-label="SDK Capability"
      className={`status-pill semantic-capability-badge semantic-capability-badge--${capability.status}`}
      title={capability.message}
    >
      {formatSemanticCapabilityLabel(capability)}
    </span>
  );
}
