import type { ClaudeCodeAgentConfig } from "./types";
export declare function loadUserAgents(anthropicProvider?: string): Record<string, ClaudeCodeAgentConfig>;
export declare function loadProjectAgents(directory?: string, anthropicProvider?: string): Record<string, ClaudeCodeAgentConfig>;
export declare function loadOpencodeGlobalAgents(): Record<string, ClaudeCodeAgentConfig>;
export declare function loadOpencodeProjectAgents(directory?: string): Record<string, ClaudeCodeAgentConfig>;
