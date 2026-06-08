import type { MarketplaceManifest } from "./types";
export interface MarketplaceSnapshotPluginSource {
    readonly name: string;
    readonly sourcePath: string;
}
export interface MarketplaceSnapshotPlugin {
    readonly name: string;
    readonly path: string;
}
export declare function writeInstalledMarketplaceSnapshot(input: {
    readonly codexHome: string;
    readonly marketplace: MarketplaceManifest;
    readonly plugins: readonly MarketplaceSnapshotPluginSource[];
}): Promise<readonly MarketplaceSnapshotPlugin[]>;
export declare function installedMarketplaceRoot(codexHome: string, marketplaceName: string): string;
