export declare function copyBundledMcpRuntimeDists(input: {
    readonly pluginRoot: string;
    readonly sourceRoot: string;
}): Promise<void>;
export declare function resolveBundledMcpRuntimeArg(pluginRoot: string, arg: string): string | null;
