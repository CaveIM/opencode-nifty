interface RepoMapping {
    github_repo: string;
    nifty_project_id: string;
    nifty_project_nice_id?: string;
    workflow_alias?: string;
    default_assignee_id?: string;
}
interface RepoMappingConfig {
    mappings: RepoMapping[];
}
export declare function loadRepoMapping(cwd: string): RepoMappingConfig | null;
export declare function findMappingForRepo(config: RepoMappingConfig | null, owner: string, repo: string): RepoMapping | null;
export declare function createMappingTemplate(): string;
export type { RepoMapping, RepoMappingConfig };
