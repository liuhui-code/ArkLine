import fs from "node:fs"

export interface HarmonySdkDiscovery {
  ready: boolean
  path: string | null
}

export function discoverHarmonySdk(
  configured = process.env.ARKLINE_HARMONY_SDK_PATH,
): HarmonySdkDiscovery {
  const resolvedPath =
    configured && configured.trim().length > 0
      ? discoverConfiguredSdk(configured)
      : discoverDefaultSdk(process.platform)

  if (resolvedPath) {
    return {
      ready: true,
      path: resolvedPath,
    }
  }

  return {
    ready: false,
    path: null,
  }
}

export function defaultHarmonySdkCandidates(platform: NodeJS.Platform): string[] {
  if (platform === "darwin") {
    return [
      "/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony",
      "/Applications/DevEco Studio.app/Contents/sdk/default/openharmony",
      "/Users/liuhui/Library/Huawei/Sdk/default/openharmony",
    ]
  }

  return []
}

function discoverConfiguredSdk(configured: string | undefined): string | null {
  if (!configured || configured.trim().length === 0) {
    return null
  }

  return configuredSdkCandidates(configured).find((candidate) => isValidSdkRoot(candidate)) ?? null
}

function discoverDefaultSdk(platform: NodeJS.Platform): string | null {
  return defaultHarmonySdkCandidates(platform).find((candidate) => isValidSdkRoot(candidate)) ?? null
}

function isValidSdkRoot(rootPath: string): boolean {
  return (
    fs.existsSync(rootPath) &&
    fs.statSync(rootPath).isDirectory() &&
    fs.existsSync(`${rootPath}/ets`) &&
    fs.existsSync(`${rootPath}/toolchains`)
  )
}

function configuredSdkCandidates(configured: string): string[] {
  const root = configured.trim().replace(/[\\/]+$/, "")
  return [
    root,
    `${root}/openharmony`,
    `${root}/default/openharmony`,
  ]
}
