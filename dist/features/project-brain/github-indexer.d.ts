import { log } from "../../shared/logger";
import type { ProjectScope } from "./scope-detector";
export interface GitHubIndexerDeps {
    fetchGitHubIssues: (owner: string, repo: string, token: string) => Promise<GitHubIssue[]>;
    fetchGitHubPRs: (owner: string, repo: string, token: string) => Promise<GitHubPR[]>;
    ingestToBrain: (source: BrainIngestSource) => Promise<{
        source_id: string;
    } | null>;
    getGitHubToken: () => string | null;
    log: typeof log;
}
export interface GitHubIssue {
    number: number;
    title: string;
    body: string;
    state: string;
    labels: string[];
    assignees: string[];
    created_at: string;
    updated_at: string;
    comments: GitHubComment[];
    html_url: string;
}
export interface GitHubPR {
    number: number;
    title: string;
    body: string;
    state: string;
    labels: string[];
    assignees: string[];
    created_at: string;
    updated_at: string;
    merged: boolean;
    html_url: string;
    comments: GitHubComment[];
}
export interface GitHubComment {
    body: string;
    user: string;
    created_at: string;
}
export interface BrainIngestSource {
    source_uri: string;
    source_type: string;
    title: string;
    content: string;
    metadata: Record<string, unknown>;
    chunks: Array<{
        content: string;
        metadata: Record<string, unknown>;
    }>;
}
export interface GitHubIndexerResult {
    indexed: number;
    skipped: number;
    errors: string[];
}
export declare function createGitHubIndexer(deps?: Partial<GitHubIndexerDeps>): {
    indexRepo: (owner: string, repo: string, scope: ProjectScope) => Promise<GitHubIndexerResult>;
};
