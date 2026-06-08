import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentPromptMetadata } from "./types";
export declare const JUNE_PROMPT_METADATA: AgentPromptMetadata;
export declare function createJuneAgent(model: string): AgentConfig;
export declare namespace createJuneAgent {
    var mode: "subagent";
}
