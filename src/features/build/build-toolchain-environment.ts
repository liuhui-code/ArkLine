import type { AppSettings } from "@/features/settings/settings-store";

export function createBuildToolchainEnvironment(settings?: AppSettings["sdk"] | null) {
  const sdkPath = settings?.harmonySdkPath.trim() ?? "";
  const nodePath = settings?.nodePath.trim() ?? "";

  return {
    pathEntries: nodePath ? [nodePath] : [],
    environment: sdkPath ? {
      HARMONY_SDK_HOME: sdkPath,
      OHOS_SDK_HOME: sdkPath,
    } : undefined,
  };
}
