export type PackagingStep = {
  command: string;
  args: string[];
};

export type PackagingTarget = "windows-installer" | "windows-portable" | "mac";

export declare function resolvePnpmExecutable(platform?: string): string;

export declare function packagingSpawnOptions(platform?: string): {
  stdio: "inherit";
  shell: boolean;
};

export declare function getOutputSummary(options?: {
  target?: PackagingTarget;
  platform?: string;
}): string;

export declare function buildPackagingSteps(options?: {
  target?: PackagingTarget;
  hostPlatform?: string;
  skipFrontendBuild?: boolean;
}): PackagingStep[];

export declare function main(argv?: string[]): void;
