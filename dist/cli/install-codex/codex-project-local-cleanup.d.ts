declare const LEGACY_AGENT_CONFLICT_KEYS: readonly ["max_threads"];
type LegacyAgentConflictKey = (typeof LEGACY_AGENT_CONFLICT_KEYS)[number];
export interface ProjectLocalCodexConfigCleanup {
    readonly projectRoot: string;
    readonly configPath: string;
    readonly changed: boolean;
    readonly removedKeys: readonly LegacyAgentConflictKey[];
    readonly backupPath?: string;
}
export interface ProjectLocalCodexArtifact {
    readonly relativePath: string;
    readonly path: string;
    readonly kind: "directory" | "file" | "other";
}
export interface ProjectLocalCodexCleanupResult {
    readonly projectRoot: string | null;
    readonly configPath: string | null;
    readonly changed: boolean;
    readonly removedKeys: readonly LegacyAgentConflictKey[];
    readonly backupPath?: string;
    readonly configs: readonly ProjectLocalCodexConfigCleanup[];
    readonly artifacts: readonly ProjectLocalCodexArtifact[];
}
export declare function repairNearestProjectLocalCodexArtifacts(input: {
    readonly startDirectory: string;
    readonly codexHome?: string;
    readonly now?: () => Date;
}): Promise<ProjectLocalCodexCleanupResult>;
export declare function emptyProjectLocalCodexCleanupResult(): ProjectLocalCodexCleanupResult;
export declare function repairProjectLocalCodexConfigText(config: string): {
    readonly config: string;
    readonly changed: boolean;
    readonly removedKeys: readonly LegacyAgentConflictKey[];
};
export {};
