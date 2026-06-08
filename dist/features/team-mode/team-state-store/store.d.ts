import type { TeamModeConfig } from "../../../config/schema/team-mode";
import { type RuntimeState, type TeamSpec } from "../types";
export declare const STALE_DELETING_TTL_MS = 60000;
export declare class RuntimeStateError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
export declare class InvalidTransitionError extends Error {
    constructor(from: string, to: string);
}
export declare function createRuntimeState(spec: TeamSpec, leadSessionId: string | undefined, specSource: "project" | "user", config: TeamModeConfig): Promise<RuntimeState>;
export declare function loadRuntimeState(teamRunId: string, config: TeamModeConfig): Promise<RuntimeState>;
export declare function saveRuntimeState(runtimeState: RuntimeState, config: TeamModeConfig): Promise<void>;
export declare function transitionRuntimeState(teamRunId: string, transition: (runtimeState: RuntimeState) => RuntimeState, config: TeamModeConfig): Promise<RuntimeState>;
export declare function listActiveTeams(config: TeamModeConfig): Promise<Array<{
    teamRunId: string;
    teamName: string;
    status: string;
    memberCount: number;
    scope: "project" | "user";
}>>;
