import type { ProjectBrainContextItem, ProjectBrainReflectionResult, ProjectBrainScope } from "./types";
export interface ProjectBrainProjection<T> {
    authoritative: false;
    team_id: string;
    project_id: string;
    updated_at: string;
    data: T;
}
export interface ProjectBrainVault {
    readContextProjection(scope: ProjectBrainScope): Promise<ProjectBrainProjection<ProjectBrainContextItem[]> | null>;
    writeContextProjection(scope: ProjectBrainScope, items: ProjectBrainContextItem[]): Promise<void>;
    recordReflectionProjection(scope: ProjectBrainScope, result: ProjectBrainReflectionResult): Promise<void>;
}
export interface ProjectBrainVaultOptions {
    workspaceRoot: string;
    cacheDir?: string;
    now?: () => Date;
}
export declare function getVaultRoot(workspaceRoot: string): string;
export declare function getVaultScopeDir(workspaceRoot: string, scope: ProjectBrainScope): string;
export declare function getLocalCachePath(workspaceRoot: string, scope: ProjectBrainScope): string;
export declare function getSyncStatePath(workspaceRoot: string, scope: ProjectBrainScope): string;
export declare function getReflectionProjectionPath(workspaceRoot: string, scope: ProjectBrainScope): string;
export declare function createProjectBrainVault(options: ProjectBrainVaultOptions): ProjectBrainVault;
