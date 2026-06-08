import { type RuntimeEnv, type SparkShellAppServerClient, type SparkShellAppServerCommand, type SparkShellAppServerResult } from "./sparkshell-appserver";
export declare const SPARKSHELL_BIN_ENV = "CAVE_MEISTER_SPARKSHELL_BIN";
export type { SparkShellAppServerClient, SparkShellAppServerCommand, SparkShellAppServerResult };
export { parseSparkShellFallbackInvocation, resolveFallbackShellArgv, SPARKSHELL_USAGE, } from "./sparkshell-parse";
export type SparkShellSpawnResult = {
    readonly status?: number | null;
    readonly signal?: string | null;
    readonly stdout?: string;
    readonly stderr?: string;
    readonly error?: Error;
};
export type SparkShellSpawn = (command: string, args: readonly string[], options: {
    readonly cwd: string;
    readonly env: RuntimeEnv;
}) => SparkShellSpawnResult;
export type SparkShellRunOptions = {
    readonly cwd?: string;
    readonly env?: RuntimeEnv;
    readonly platform?: NodeJS.Platform;
    readonly spawn?: SparkShellSpawn;
    readonly writeStdout?: (value: string) => void;
    readonly writeStderr?: (value: string) => void;
    readonly commandExists?: (command: string) => boolean;
    readonly appServerClient?: SparkShellAppServerClient | null;
};
export declare function runSparkShell(args: readonly string[], options?: SparkShellRunOptions): Promise<number>;
