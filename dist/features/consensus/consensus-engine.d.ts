import type { PluginInput } from "@opencode-ai/plugin";
import type { ConsensusConfig } from "../../config/schema/consensus";
import { fetchAvailableModels, getConnectedProviders } from "../../shared/model-availability";
import { spawnVoter } from "./voter-spawner";
import { type ConsensusInput, type ConsensusResult } from "./types";
type RunConsensusDeps = {
    spawnVoter: typeof spawnVoter;
    getConnectedProviders: typeof getConnectedProviders;
    fetchAvailableModels: typeof fetchAvailableModels;
};
export declare function runConsensus(ctx: PluginInput, input: ConsensusInput, config: ConsensusConfig | undefined, deps?: RunConsensusDeps): Promise<ConsensusResult>;
export {};
