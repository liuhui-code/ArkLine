import type { AppSettings } from "@/features/settings/settings-store";

export type BuildToolchainEnvironment = {
  pathEntries: string[];
  environment: Record<string, string>;
};

export function createBuildToolchainEnvironment(settings?: AppSettings["sdk"] | null): BuildToolchainEnvironment {
  const sdkPath = settings?.harmonySdkPath.trim() ?? "";
  const nodePath = settings?.nodePath.trim() ?? "";

  return {
    pathEntries: nodePath ? [nodePath] : [],
    environment: sdkPath ? {
      ARKLINE_HARMONY_SDK_PATH: sdkPath,
      HOS_SDK_HOME: sdkPath,
      HARMONY_SDK_HOME: sdkPath,
      OHOS_SDK_HOME: sdkPath,
      DEVECO_SDK_HOME: sdkPath,
    } : {},
  };
}
