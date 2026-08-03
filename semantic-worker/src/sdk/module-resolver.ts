import fs from "node:fs"
import path from "node:path"

export function harmonySdkModuleCandidates(
  sdkRoot: string,
  moduleSpecifier: string,
): string[] {
  if (!moduleSpecifier.startsWith("@ohos.")) return []
  return [
    path.join(sdkRoot, "js", "api", `${moduleSpecifier}.d.ts`),
    path.join(sdkRoot, "js", "api", `${moduleSpecifier}.d.ets`),
    path.join(sdkRoot, "ets", "api", `${moduleSpecifier}.d.ts`),
    path.join(sdkRoot, "ets", "api", `${moduleSpecifier}.d.ets`),
  ]
}

export function resolveHarmonySdkModule(
  sdkRoot: string,
  moduleSpecifier: string,
): string | null {
  return harmonySdkModuleCandidates(sdkRoot, moduleSpecifier)
    .find((candidate) => fs.existsSync(candidate)) ?? null
}
