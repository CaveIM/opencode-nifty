import type { RunCommand } from "./types";
export type GitBashSource = "not-required" | "env" | "program-files" | "program-files-x86" | "path";
export type GitBashResolution = {
    readonly found: true;
    readonly path: string | null;
    readonly source: GitBashSource;
} | {
    readonly found: false;
    readonly checkedPaths: readonly string[];
    readonly installHint: string;
};
export interface GitBashResolverInput {
    readonly platform: string;
    readonly env: {
        readonly [key: string]: string | undefined;
    };
    readonly exists: (path: string) => boolean;
    readonly where: (command: "bash") => readonly string[];
}
export declare function resolveGitBash(input: GitBashResolverInput): GitBashResolution;
export declare function resolveGitBashForCurrentProcess(input?: {
    readonly platform?: string;
    readonly env?: {
        readonly [key: string]: string | undefined;
    };
}): GitBashResolution;
export declare function prepareGitBashForInstall(input: {
    readonly platform: string;
    readonly env: {
        readonly [key: string]: string | undefined;
    };
    readonly cwd: string;
    readonly runCommand: RunCommand;
    readonly resolveGitBash?: () => GitBashResolution;
}): Promise<GitBashResolution>;
