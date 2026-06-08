import type { ProjectBrainDocument, ProjectBrainOpenRequest, ProjectBrainReflectionProposal, ProjectBrainReflectionResult, ProjectBrainSearchRequest, ProjectBrainSearchResult, ProjectBrainStatus, ProjectBrainStatusRequest } from "./types";
export interface ProjectBrainClientOptions {
    baseUrl: string;
    tokenEnv: string;
    fetchFn?: typeof globalThis.fetch;
    env?: Record<string, string | undefined>;
    requestTimeoutMs?: number;
    maxResults?: number;
}
export interface ProjectBrainClient {
    search(request: ProjectBrainSearchRequest): Promise<ProjectBrainSearchResult>;
    open(request: ProjectBrainOpenRequest): Promise<ProjectBrainDocument>;
    proposeReflection(proposal: ProjectBrainReflectionProposal): Promise<ProjectBrainReflectionResult>;
    status(request: ProjectBrainStatusRequest): Promise<ProjectBrainStatus>;
}
export declare function createProjectBrainClient(options: ProjectBrainClientOptions): ProjectBrainClient;
export { createProjectBrainClient as createBrainClient };
export type { ProjectBrainClient as BrainClient, ProjectBrainClientOptions as BrainClientOptions };
