import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { Task } from "../types";
export declare class AlreadyClaimedError extends Error {
    constructor(message?: string);
}
export declare class BlockedByError extends Error {
    readonly blockers: string[];
    constructor(blockers: string[]);
}
export declare function claimTask(teamRunId: string, taskId: string, memberName: string, config: TeamModeConfig): Promise<Task>;
