import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentPromptMetadata } from "./types";
export declare const MAR_PROMPT_METADATA: AgentPromptMetadata;
export declare function createMarAgent(model: string): AgentConfig;
export declare namespace createMarAgent {
    var mode: "subagent";
}
