export interface LinkedAgent {
    readonly name: string;
    readonly path: string;
    readonly target: string;
}
type LinkPlatform = NodeJS.Platform;
export declare function capturePreservedAgentReasoning(input: {
    readonly codexHome: string;
}): Promise<ReadonlyMap<string, string>>;
export declare function linkCachedPluginAgents(input: {
    readonly codexHome: string;
    readonly pluginRoot: string;
    readonly platform?: LinkPlatform;
    readonly preservedReasoning?: ReadonlyMap<string, string>;
}): Promise<readonly LinkedAgent[]>;
export {};
