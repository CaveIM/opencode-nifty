import type { MarketplaceManifest, MarketplacePluginEntry, PluginManifest } from "./types";
export declare function readMarketplace(repoRoot: string, options?: {
    readonly marketplacePath?: string;
}): Promise<MarketplaceManifest>;
export declare function resolvePluginSource(repoRoot: string, plugin: MarketplacePluginEntry, options?: {
    readonly pathOverride?: string;
}): string;
export declare function readPluginManifest(pluginRoot: string): Promise<PluginManifest>;
export declare function validatePathSegment(value: string, label: string): void;
