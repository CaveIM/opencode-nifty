export type RuntimeEnv = Readonly<Record<string, string | undefined>>;
export type SparkShellAppServerCommand = {
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly env: RuntimeEnv;
};
export type SparkShellAppServerResult = {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
};
export interface SparkShellAppServerClient {
    getPlatform(): Promise<NodeJS.Platform>;
    exec(command: SparkShellAppServerCommand): Promise<SparkShellAppServerResult>;
}
export declare function createDefaultSparkShellAppServerClient(env: RuntimeEnv): SparkShellAppServerClient | null;
