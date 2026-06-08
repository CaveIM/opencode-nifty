export declare function pruneMarketplaceCache(input: {
    readonly codexHome: string;
    readonly marketplaceName: string;
    readonly keepPluginNames: readonly string[];
}): Promise<void>;
export declare function pruneMarketplacePluginCaches(input: {
    readonly codexHome: string;
    readonly marketplaceName: string;
    readonly pluginNames: readonly string[];
}): Promise<void>;
