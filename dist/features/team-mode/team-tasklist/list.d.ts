import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { Task } from "../types";
type TaskListFilter = {
    status?: Task["status"];
    owner?: string;
};
export declare function listTasks(teamRunId: string, config: TeamModeConfig, filter?: TaskListFilter): Promise<Task[]>;
export {};
