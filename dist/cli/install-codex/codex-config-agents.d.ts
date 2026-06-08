import type { CodexAgentConfig } from "./types";
export declare function removeStaleManagedAgentBlocks(config: string, keepAgentNames: Set<string>): string;
export declare function ensureAgentConfig(config: string, agentConfig: CodexAgentConfig): string;
