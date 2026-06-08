/**
 * Fetches the latest commit hash from GitHub for the configured branch.
 * Returns null on network failure or if the repo/branch is not found.
 */
export declare function getGitHubLatestCommit(): Promise<string | null>;
/**
 * Fetches a version identifier from a raw GitHub file.
 * This is a lighter-weight check that does not use the GitHub API.
 */
export declare function getGitHubRawVersion(): Promise<string | null>;
