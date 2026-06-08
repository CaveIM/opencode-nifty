import type { ProjectLocalCodexCleanupResult } from "./codex-project-local-cleanup";
export declare function repairProjectLocalCodexArtifactsBestEffort(input: {
    readonly startDirectory: string;
    readonly codexHome: string;
    readonly now?: () => Date;
    readonly log: (message: string) => void;
}): Promise<ProjectLocalCodexCleanupResult>;
