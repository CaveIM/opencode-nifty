export type CodexUlwLoopCommand = {
    readonly executable: string;
    readonly argsPrefix: readonly string[];
};
type ResolveCodexUlwLoopCommandInput = {
    readonly env?: NodeJS.ProcessEnv;
    readonly homeDir?: string;
    readonly currentExecutablePaths?: readonly string[];
};
export declare function resolveCodexUlwLoopCommand(input?: ResolveCodexUlwLoopCommandInput): CodexUlwLoopCommand | null;
export declare function codexUlwLoop(args: readonly string[]): Promise<number>;
export {};
