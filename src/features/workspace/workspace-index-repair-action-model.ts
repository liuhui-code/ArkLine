export function repairActionFromRecommendedAction(action: unknown) {
  if (action === "rebuildIndex") {
    return "rebuildProjectIndex";
  }
  if (action === "configureSdk") {
    return "configureSdk";
  }
  return null;
}

export function repairActionFromPayload(payloadJson: string) {
  try {
    const payload = JSON.parse(payloadJson) as { recommendedAction?: unknown };
    return repairActionFromRecommendedAction(payload.recommendedAction);
  } catch {
    return null;
  }
}
