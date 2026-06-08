import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentPromptMetadata } from "../types";
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
export type TonyPromptSource = "gpt-5-5" | "gpt-5-4" | "gpt";
export declare function getTonyPromptSource(model?: string): TonyPromptSource;
export interface TonyContext {
    model?: string;
    availableAgents?: AvailableAgent[];
    availableTools?: AvailableTool[];
    availableSkills?: AvailableSkill[];
    availableCategories?: AvailableCategory[];
    useTaskSystem?: boolean;
}
export declare function getTonyPrompt(model?: string, useTaskSystem?: boolean): string;
export declare function createTonyAgent(model: string, availableAgents?: AvailableAgent[], availableToolNames?: string[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): AgentConfig;
export declare namespace createTonyAgent {
    var mode: "primary";
}
export declare const tonyPromptMetadata: AgentPromptMetadata;
