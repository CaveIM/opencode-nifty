import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { Task } from "../types";
export declare class InvalidTaskTransitionError extends Error {
    constructor(currentStatus: Task["status"], nextStatus: Task["status"]);
}
export declare class CrossOwnerUpdateError extends Error {
    constructor(message?: string);
}
export declare function updateTaskStatus(teamRunId: string, taskId: string, newStatus: Task["status"], memberName: string, config: TeamModeConfig): Promise<Task>;
