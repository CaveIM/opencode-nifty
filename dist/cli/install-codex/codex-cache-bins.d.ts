type LinkPlatform = NodeJS.Platform;
export declare function linkCachedPluginBins(input: {
    readonly binDir: string;
    readonly pluginRoot: string;
    readonly platform?: LinkPlatform;
}): Promise<readonly {
    name: string;
    path: string;
    target: string;
}[]>;
export declare function linkRootRuntimeBin(input: {
    readonly binDir: string;
    readonly codexHome: string;
    readonly repoRoot: string;
    readonly platform?: LinkPlatform;
}): Promise<{
    readonly name: string;
    readonly path: string;
    readonly target: string;
} | null>;
export {};
