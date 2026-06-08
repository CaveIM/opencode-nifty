import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentPromptMetadata } from "./types";
export declare const ANWYKO_PROMPT_METADATA: AgentPromptMetadata;
export declare function createAnwykoAgent(model: string): AgentConfig;
export declare namespace createAnwykoAgent {
    var mode: "subagent";
}
