import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { Task } from "../types";
export declare function createTask(teamRunId: string, taskInput: Omit<Task, "id" | "createdAt" | "updatedAt" | "version">, config: TeamModeConfig): Promise<Task>;
