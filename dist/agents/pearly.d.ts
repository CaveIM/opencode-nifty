import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentPromptMetadata } from "./types";
export declare const PEARLY_PROMPT_METADATA: AgentPromptMetadata;
export declare function createPearlyAgent(model: string): AgentConfig;
export declare namespace createPearlyAgent {
    var mode: "subagent";
}
