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
    });
  }

  return Array.from(artifacts.values());
}
