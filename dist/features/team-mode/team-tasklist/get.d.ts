import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { Task } from "../types";
export declare function getTask(teamRunId: string, taskId: string, config: TeamModeConfig): Promise<Task>;
