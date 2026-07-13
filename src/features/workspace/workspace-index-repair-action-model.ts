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
  if (action === "inspectIndex") {
    return "inspectIndex";
  }
  if (action === "resumeIndexing") {
    return "resumeIndexing";
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
    const payload = JSON.parse(payloadJson) as { recommendedAction?: unknown; explain?: unknown };
    return repairActionFromRecommendedAction(payload.recommendedAction)
      ?? repairActionFromRecommendedAction(explainAction(payload.explain));
  } catch {
    return null;
  }
}

function explainAction(explain: unknown) {
  if (!Array.isArray(explain)) {
    return null;
  }
  const action = explain.find((item) => typeof item === "string" && item.startsWith("action:"));
  return typeof action === "string" ? action.slice("action:".length) : null;
}
