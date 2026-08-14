import type { BuildArtifact, BuildArtifactKind } from "@/features/build/build-model";

const artifactPattern = /((?:[A-Za-z]:)?[\\/][^\s"'<>]+?\.(hap|app|har|hsp))\b/gi;

export function extractBuildArtifacts(output: string): BuildArtifact[] {
  const artifacts = new Map<string, BuildArtifact>();
  let match: RegExpExecArray | null;

  while ((match = artifactPattern.exec(output)) !== null) {
    const path = match[1];
    const kind = match[2].toLowerCase() as BuildArtifactKind;

    artifacts.set(path, {
      path,
      kind,
      source: "output",
      signature: inferArtifactSignature(path, kind),
    });
  }

  return Array.from(artifacts.values());
}

export function inferArtifactSignature(
  path: string,
  kind: BuildArtifactKind,
): BuildArtifact["signature"] {
  if (kind === "har") {
    return "not-applicable";
  }
  const fileName = path.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
  if (/(?:^|[-_])unsigned(?:[-_.]|$)/.test(fileName)) {
    return "unsigned";
  }
  if (/(?:^|[-_])signed(?:[-_.]|$)/.test(fileName)) {
    return "signed";
  }
  // A custom artifact name may omit both suffixes. Do not claim it is signed
  // without explicit evidence from the produced artifact.
  return "unknown";
}
