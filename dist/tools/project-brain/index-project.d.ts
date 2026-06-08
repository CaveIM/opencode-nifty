import type { ToolDefinition } from "@opencode-ai/plugin";
import { log } from "../../shared/logger";
import { createScopeDetector } from "../../features/project-brain/scope-detector";
import { createNiftyIndexer } from "../../features/project-brain/nifty-indexer";
import { createGitHubIndexer } from "../../features/project-brain/github-indexer";
export interface IndexProjectDeps {
    scopeDetector: ReturnType<typeof createScopeDetector>;
    niftyIndexer: ReturnType<typeof createNiftyIndexer>;
    githubIndexer: ReturnType<typeof createGitHubIndexer>;
    log: typeof log;
}
export declare function createIndexProjectTool(deps?: Partial<IndexProjectDeps>): ToolDefinition;
