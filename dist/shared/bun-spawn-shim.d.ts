import { type SpawnOptions as NodeSpawnOptions, type SpawnSyncOptions as NodeSpawnSyncOptions } from "node:child_process";
type StdioMode = "pipe" | "inherit" | "ignore";
type StdioTuple = [StdioMode, StdioMode, StdioMode];
export interface SpawnOptions {
    cmd?: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: StdioMode;
    stdout?: StdioMode;
    stderr?: StdioMode;
    stdio?: StdioTuple;
    detached?: boolean;
    signal?: AbortSignal;
}
export interface SpawnedProcess {
    readonly exitCode: number | null;
    readonly exited: Promise<number>;
    readonly stdout: ReadableStream<Uint8Array>;
    readonly stderr: ReadableStream<Uint8Array>;
    readonly stdin: NodeJS.WritableStream;
    readonly pid: number | undefined;
    kill(signal?: NodeJS.Signals): void;
    ref(): void;
    unref(): void;
}
export interface SpawnSyncResult {
    readonly exitCode: number;
    readonly stdout: Buffer | undefined;
    readonly stderr: Buffer | undefined;
    readonly success: boolean;
    readonly pid: number;
}
export declare function createNodeSpawnOptions(options: SpawnOptions, platform?: NodeJS.Platform): NodeSpawnOptions;
export declare function createNodeSpawnSyncOptions(options: SpawnOptions, platform?: NodeJS.Platform): NodeSpawnSyncOptions;
export declare function spawn(command: string[], options?: SpawnOptions): SpawnedProcess;
export declare function spawn(options: SpawnOptions & {
    cmd: string[];
}): SpawnedProcess;
export declare function spawnSync(command: string[], options?: SpawnOptions): SpawnSyncResult;
export declare function spawnSync(options: SpawnOptions & {
    cmd: string[];
}): SpawnSyncResult;
export {};
