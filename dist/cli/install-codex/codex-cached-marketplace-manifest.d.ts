import type { InstalledPlugin } from "./types";
export declare function writeCachedMarketplaceManifest(input: {
    readonly marketplaceName: string;
    readonly marketplaceRoot: string;
    readonly plugins: readonly InstalledPlugin[];
}): Promise<void>;
