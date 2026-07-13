export function repairActionFromRecommendedAction(action: unknown) {
  if (action === "rebuildIndex") {
    return "rebuildProjectIndex";
  }
  if (action === "rebuildSdkIndex") {
    return "rebuildSdkIndex";
  }
  if (action === "configureSdk") {
    return "configureSdk";
  }
  if (action === "indexCurrentFile") {
    return "indexCurrentFile";
  }
  if (action === "inspectParserFailures") {
    return "inspectParserFailures";
  }
  if (action === "inspectUnresolvedImports") {
    return "inspectUnresolvedImports";
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
