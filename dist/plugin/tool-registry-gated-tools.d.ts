import type { ToolDefinition } from "@opencode-ai/plugin";
import type { OhMyOpenCodeConfig } from "../config";
import type { PluginContext } from "./types";
import type { ToolRegistryFactories } from "./tool-registry-factories";
export declare function createTaskToolsRecord(args: {
    readonly taskSystemEnabled: boolean;
    readonly pluginConfig: OhMyOpenCodeConfig;
    readonly ctx: PluginContext;
    readonly factories: ToolRegistryFactories;
}): Record<string, ToolDefinition>;
export declare function createHashlineToolsRecord(args: {
    readonly pluginConfig: OhMyOpenCodeConfig;
    readonly ctx: PluginContext;
    readonly factories: ToolRegistryFactories;
}): Record<string, ToolDefinition>;
export declare function createConsensusToolsRecord(args: {
    readonly pluginConfig: OhMyOpenCodeConfig;
    readonly ctx: PluginContext;
    readonly factories: ToolRegistryFactories;
}): Record<string, ToolDefinition>;
export declare function createProjectBrainToolsRecord(args: {
    readonly pluginConfig: OhMyOpenCodeConfig;
    readonly ctx: PluginContext;
    readonly factories: ToolRegistryFactories;
}): Record<string, ToolDefinition>;
export declare function getTaskSystemEnabled(pluginConfig: OhMyOpenCodeConfig): boolean;
