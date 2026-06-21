import { formatSemanticModeLabel, type SemanticState } from "@/features/semantic/semantic-store";

type SemanticModeBadgeProps = {
  semanticState: SemanticState;
};

export function SemanticModeBadge({ semanticState }: SemanticModeBadgeProps) {
  return (
    <span
      aria-label="Semantic Mode"
      className={`status-pill semantic-mode-badge semantic-mode-badge--${semanticState.mode}`}
      title={semanticState.detail}
    >
      {formatSemanticModeLabel(semanticState.mode)}
    </span>
  );
}
