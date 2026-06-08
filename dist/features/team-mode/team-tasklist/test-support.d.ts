import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { Task } from "../types";
export declare function createTasklistFixture(): Promise<{
    config: TeamModeConfig;
    rootDirectory: string;
    teamRunId: string;
    cleanup: () => Promise<void>;
}>;
export declare function createTaskInput(overrides?: Partial<Omit<Task, "id" | "createdAt" | "updatedAt" | "version">>): Omit<Task, "id" | "createdAt" | "updatedAt" | "version">;
