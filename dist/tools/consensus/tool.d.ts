import { type PluginInput, type ToolDefinition } from "@opencode-ai/plugin";
import type { ConsensusConfig } from "../../config/schema/consensus";
import { runConsensus } from "../../features/consensus";
declare const isSubagentSession: (sessionID: string) => boolean;
type ConsensusToolDeps = {
    runConsensus: typeof runConsensus;
    isSubagentSession: typeof isSubagentSession;
};
export declare function createConsensusTool(ctx: PluginInput, consensusConfig: ConsensusConfig | undefined, deps?: ConsensusToolDeps): ToolDefinition;
export {};
