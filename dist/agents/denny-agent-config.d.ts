import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode } from "./types";
export declare function buildGptDennyAgentConfig(mode: AgentMode, model: string, prompt: string): AgentConfig;
export declare function buildClaudeDennyAgentConfig(mode: AgentMode, model: string, prompt: string): AgentConfig;
