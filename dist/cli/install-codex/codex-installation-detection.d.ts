import type { CodexInstallPlatform } from "./types";
export type CodexInstallationSource = "cli" | "mac-app" | "windows-standard-cli" | "windows-start-app";
type CodexInstallationPathSource = Exclude<CodexInstallationSource, "windows-start-app">;
export type CodexInstallationDetection = {
    readonly found: true;
    readonly source: CodexInstallationPathSource;
    readonly path: string;
} | {
    readonly found: true;
    readonly source: "windows-start-app";
    readonly appId: string;
} | {
    readonly found: false;
    readonly checkedPaths: readonly string[];
    readonly hint: string;
    readonly downloadedInstallerPath?: string;
};
export interface CodexInstallationCommandResult {
    readonly success: boolean;
    readonly stdout: string;
}
export interface CodexInstallationDetectorInput {
    readonly platform?: CodexInstallPlatform;
    readonly env?: {
        readonly [key: string]: string | undefined;
    };
    readonly homeDir?: string;
    readonly exists?: (path: string) => boolean;
    readonly which?: (command: "codex") => string | null | undefined;
    readonly runCommand?: (command: string, args: readonly string[]) => Promise<CodexInstallationCommandResult>;
}
export declare function detectCodexInstallation(input?: CodexInstallationDetectorInput): Promise<CodexInstallationDetection>;
export declare function formatCodexInstallationWarning(detection: Extract<CodexInstallationDetection, {
    readonly found: false;
}>): string;
export {};
