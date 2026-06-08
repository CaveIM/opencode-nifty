export declare const MANAGED_CODEX_AGENT_NAMES: readonly ["codex-ultrawork-reviewer", "explorer", "mar", "metis", "momus", "plan"];
export declare function cleanupCodexLightConfigText(config: string): string;
export declare function cleanupCodexConfig(configPath: string, now: (() => Date) | undefined): Promise<{
    readonly changed: boolean;
    readonly backupPath?: string;
}>;
