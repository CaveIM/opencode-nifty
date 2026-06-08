import type { CodexInstallOptions, CodexInstallResult } from "./types";
export declare function runCodexInstaller(options?: CodexInstallOptions): Promise<CodexInstallResult>;
export declare function resolveCodexInstallerBinDir(input: {
    readonly binDir?: string;
    readonly codexHome: string;
    readonly env?: {
        readonly [key: string]: string | undefined;
    };
    readonly homeDir?: string;
}): string;
export declare function findRepoRootFromImporter(importerDir: string): string;
export declare function findRepoRoot(input: {
    readonly importerDir: string;
    readonly env?: {
        readonly [key: string]: string | undefined;
    };
}): string;
