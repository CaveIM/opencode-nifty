declare function getGitHubToken(): string | null;
interface CreateIssueParams {
    owner: string;
    repo: string;
    title: string;
    body: string;
    labels?: string[];
}
interface GitHubIssue {
    number: number;
    html_url: string;
    title: string;
    state: string;
}
export declare function createGitHubIssue(params: CreateIssueParams): Promise<GitHubIssue>;
export declare function getGitHubRepoFromGitConfig(cwd: string): Promise<{
    owner: string;
    repo: string;
} | null>;
export { getGitHubToken };
