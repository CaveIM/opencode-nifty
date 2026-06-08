import type { TeamModeConfig } from "../../../config/schema/team-mode";
export declare function resolveBaseDir(config: TeamModeConfig): string;
export declare function getTeamSpecPath(baseDir: string, teamName: string, scope: "user" | "project", projectRoot?: string): string;
export declare function getRuntimeStateDir(baseDir: string, teamRunId: string): string;
export declare function getInboxDir(baseDir: string, teamRunId: string, memberName: string): string;
export declare function getTasksDir(baseDir: string, teamRunId: string): string;
export declare function getWorktreeDir(baseDir: string, teamRunId: string, memberName: string): string;
export declare function discoverTeamSpecs(config: TeamModeConfig, projectRoot: string): Promise<Array<{
    name: string;
    scope: "project" | "user";
    path: string;
}>>;
export declare function ensureBaseDirs(baseDir: string): Promise<void>;
