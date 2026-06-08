import type { ProjectBrainConfig } from "../../config/schema/project-brain";
import type { ContextCollector } from "../../features/context-injector";
import { createProjectBrainClient, createProjectBrainVault, formatSearchResult } from "../../features/project-brain";
import type { PluginContext } from "../../plugin/types";
import { log } from "../../shared";
type TransformPart = {
    type: string;
    text?: string;
    synthetic?: boolean;
    [key: string]: unknown;
};
type TransformMessageInfo = {
    role: string;
    id?: string;
    sessionID?: string;
    [key: string]: unknown;
};
type MessageWithParts = {
    info: TransformMessageInfo;
    parts: TransformPart[];
};
type MessagesTransformInput = {
    sessionID?: string;
    [key: string]: unknown;
};
type MessagesTransformOutput = {
    messages: MessageWithParts[];
};
type ToolExecuteAfterInput = {
    tool: string;
    sessionID: string;
    callID?: string;
    args?: Record<string, unknown>;
};
type ToolExecuteAfterOutput = {
    title: string;
    output: string;
    metadata: Record<string, unknown>;
};
type ProjectBrainHookDeps = {
    createProjectBrainClient: typeof createProjectBrainClient;
    createProjectBrainVault: typeof createProjectBrainVault;
    formatSearchResult: typeof formatSearchResult;
    log: typeof log;
};
type CreateProjectBrainHookArgs = {
    ctx: Pick<PluginContext, "directory"> | {
        directory?: string;
    };
    config?: ProjectBrainConfig;
    collector: ContextCollector;
    deps?: Partial<ProjectBrainHookDeps>;
};
export type ProjectBrainHook = {
    "experimental.chat.messages.transform"?: (input: MessagesTransformInput, output: MessagesTransformOutput) => Promise<void>;
    "tool.execute.after"?: (input: ToolExecuteAfterInput, output: ToolExecuteAfterOutput) => Promise<void>;
};
export declare function createProjectBrainHook(args: CreateProjectBrainHookArgs): ProjectBrainHook;
export {};
