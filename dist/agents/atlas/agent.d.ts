/**
 * Atlas - Master Orchestrator Agent
 *
 * Orchestrates work via task() to complete ALL tasks in a todo list until fully done.
 *
 * Prompt routing (`getAtlasPromptSource`, evaluated by prompts-core variant order):
 * 1. Claude Opus 4.7       → opus-4-7.md   (literal-following + explicit fan-out push)
 * 2. GPT family            → gpt.md        (calibrated for GPT-5.5)
 * 3. Gemini family         → gemini.md
 * 4. Kimi K2.x family      → kimi.md       (Claude-family base + K2.6 thinking-mode calibration)
 * 5. Default (Claude 4.6 family: opus-4-6, sonnet-4-6, haiku-4-5, etc.) → default.md
 */
import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentPromptMetadata } from "../types";
import type { AvailableAgent, AvailableSkill } from "../dynamic-agent-prompt-builder";
import type { CategoryConfig } from "../../config/schema";
export type AtlasPromptSource = "default" | "gpt" | "gemini" | "kimi" | "opus-4-7";
export declare function getAtlasPromptSource(model?: string): AtlasPromptSource;
export interface OrchestratorContext {
    model?: string;
    availableAgents?: AvailableAgent[];
    availableSkills?: AvailableSkill[];
    userCategories?: Record<string, CategoryConfig>;
}
export declare function getAtlasPrompt(model?: string): string;
export declare function createAtlasAgent(ctx: OrchestratorContext): AgentConfig;
export declare namespace createAtlasAgent {
    var mode: "primary";
}
export declare const atlasPromptMetadata: AgentPromptMetadata;
