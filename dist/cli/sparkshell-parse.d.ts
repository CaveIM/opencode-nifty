export declare const SPARKSHELL_USAGE: string;
export type SparkShellFallbackInvocation = {
    readonly kind: "command";
    readonly argv: readonly string[];
} | {
    readonly kind: "tmux-pane";
    readonly argv: readonly string[];
};
type RuntimeEnv = Readonly<Record<string, string | undefined>>;
export declare function resolveFallbackShellArgv(script: string, options?: {
    readonly platform?: NodeJS.Platform;
    readonly env?: RuntimeEnv;
    readonly commandExists?: (command: string) => boolean;
}): readonly string[];
export declare function parseSparkShellFallbackInvocation(rawArgs: readonly string[], options?: {
    readonly platform?: NodeJS.Platform;
    readonly env?: RuntimeEnv;
    readonly commandExists?: (command: string) => boolean;
}): SparkShellFallbackInvocation;
export declare function hasTopLevelSparkShellHelpFlag(args: readonly string[]): boolean;
export {};
