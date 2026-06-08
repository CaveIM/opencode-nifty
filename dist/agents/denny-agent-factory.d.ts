import type { AgentConfig } from "@opencode-ai/sdk";
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "./dynamic-agent-prompt-builder";
export declare function createDennyAgent(model: string, availableAgents?: AvailableAgent[], availableToolNames?: string[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): AgentConfig;
export declare namespace createDennyAgent {
    var mode: "primary";
}
