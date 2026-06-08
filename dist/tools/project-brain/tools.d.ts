import { type ToolDefinition } from "@opencode-ai/plugin";
import type { OhMyOpenCodeConfig } from "../../config";
import { createProjectBrainClient, formatDocument, formatReflectionResult, formatSearchResult, formatStatus } from "../../features/project-brain";
import type { PluginContext } from "../../plugin/types";
type ProjectBrainToolDeps = {
    createProjectBrainClient: typeof createProjectBrainClient;
    formatDocument: typeof formatDocument;
    formatReflectionResult: typeof formatReflectionResult;
    formatSearchResult: typeof formatSearchResult;
    formatStatus: typeof formatStatus;
};
export declare function createProjectBrainTools(pluginConfig: OhMyOpenCodeConfig, ctx: PluginContext, deps?: Partial<ProjectBrainToolDeps>): Record<string, ToolDefinition>;
export {};
