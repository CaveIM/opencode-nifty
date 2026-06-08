import type { ProjectLocalCodexCleanupResult } from "./codex-project-local-cleanup";
export interface CodexCleanupOptions {
    readonly codexHome?: string;
    readonly projectDirectory?: string;
    readonly env?: {
        readonly [key: string]: string | undefined;
    };
    readonly now?: () => Date;
}
export interface CodexCleanupResult {
    readonly codexHome: string;
    readonly configPath: string;
    readonly configChanged: boolean;
    readonly configBackupPath?: string;
    readonly removedPaths: readonly string[];
    readonly removedAgentLinks: readonly string[];
    readonly skippedAgentLinks: readonly string[];
    readonly projectCleanup: ProjectLocalCodexCleanupResult;
}
export declare function cleanupCodexLight(input?: CodexCleanupOptions): Promise<CodexCleanupResult>;
export { cleanupCodexLightConfigText } from "./codex-cleanup-config";
