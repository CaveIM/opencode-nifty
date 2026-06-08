import type { AgentScope, ClaudeCodeAgentConfig, LoadedAgent } from "./types";
export declare function parseMarkdownAgentFile(filePath: string, scope: AgentScope, anthropicProvider?: string): LoadedAgent | null;
export declare function loadAgentDefinitions(paths: string[], scope: AgentScope, anthropicProvider?: string): Record<string, ClaudeCodeAgentConfig>;
