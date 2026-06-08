import { log } from "../../shared/logger";
export interface ProjectScope {
    team_id: string;
    project_id: string;
}
export interface ScopeDetectorDeps {
    readGitConfig: (cwd: string) => string | null;
    readRepoMapping: (cwd: string) => RepoMapping | null;
    log: typeof log;
}
export interface RepoMapping {
    mappings: Array<{
        github_repo: string;
        nifty_project_id: string;
        nifty_team_id?: string;
        default_assignee_id?: string;
    }>;
}
export interface ScopeDetectorResult {
    scope: ProjectScope | null;
    source: "repo-mapping" | "git-remote" | "default" | null;
    github_repo?: string;
    nifty_project_id?: string;
}
export declare function createScopeDetector(deps?: Partial<ScopeDetectorDeps>): ScopeDetectorResult & {
    detect: (cwd: string, defaultScope?: ProjectScope) => ScopeDetectorResult;
};
