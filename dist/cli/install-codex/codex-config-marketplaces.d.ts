import type { CodexMarketplaceSource } from "./types";
export declare function legacyMarketplaceNames(marketplaceName: string): readonly string[];
export declare function removeMarketplaceBlock(config: string, marketplaceName: string): string;
export declare function removeStaleMarketplacePluginBlocks(config: string, marketplaceName: string, keepPluginNames: Set<string>): string;
export declare function removeStaleMarketplaceHookStateBlocks(config: string, marketplaceName: string, keepPluginNames: Set<string>): string;
export declare function ensureMarketplaceBlock(config: string, marketplaceName: string, source: CodexMarketplaceSource): string;
