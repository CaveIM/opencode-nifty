import type { ToolDefinition } from "@opencode-ai/plugin";
export type NiftyCreateBugDeps = {
    getGitHubToken: () => string | null;
    createGitHubIssue: (params: {
        owner: string;
        repo: string;
        title: string;
        body: string;
        labels?: string[];
    }) => Promise<{
        number: number;
        html_url: string;
        title: string;
    }>;
    getGitHubRepoFromGitConfig: (cwd: string) => {
        owner: string;
        repo: string;
    } | null;
    loadRepoMapping: (cwd: string) => {
        mappings: Array<{
            github_repo: string;
            nifty_project_id: string;
            default_assignee_id?: string;
        }>;
    } | null;
};
declare function defaultGetGitHubToken(): string | null;
declare function defaultCreateGitHubIssue(params: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    labels?: string[];
}): Promise<{
    number: number;
    html_url: string;
    title: string;
}>;
declare function defaultGetGitHubRepoFromGitConfig(cwd: string): {
    owner: string;
    repo: string;
} | null;
declare function defaultLoadRepoMapping(cwd: string): {
    mappings: Array<{
        github_repo: string;
        nifty_project_id: string;
        default_assignee_id?: string;
    }>;
} | null;
declare function findMappingForRepo(config: {
    mappings: Array<{
        github_repo: string;
        nifty_project_id: string;
        default_assignee_id?: string;
    }>;
} | null, owner: string, repo: string): {
    github_repo: string;
    nifty_project_id: string;
    default_assignee_id?: string;
} | null;
export declare function createNiftyCreateBugTool(deps?: Partial<NiftyCreateBugDeps>): ToolDefinition;
export { defaultGetGitHubToken, defaultCreateGitHubIssue, defaultGetGitHubRepoFromGitConfig, defaultLoadRepoMapping, findMappingForRepo, };
