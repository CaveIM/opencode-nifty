export interface DistributionManifest {
    readonly name: string;
    readonly version: string;
}
export declare function readDistributionManifest(repoRoot: string): Promise<DistributionManifest | undefined>;
export declare function resolveLazyCodexPluginVersion(input: {
    readonly manifestVersion?: string;
    readonly marketplaceName: string;
    readonly pluginName: string;
    readonly distributionManifest?: DistributionManifest;
}): string;
export declare function stampLazyCodexPluginVersion(input: {
    readonly pluginRoot: string;
    readonly version: string;
}): Promise<void>;
export declare function writeLazyCodexInstallSnapshot(input: {
    readonly pluginRoot: string;
    readonly distributionManifest?: DistributionManifest;
}): Promise<void>;
