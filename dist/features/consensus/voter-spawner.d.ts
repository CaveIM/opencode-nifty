import type { PluginInput } from "@opencode-ai/plugin";
import type { ResolvedVoterCandidate, VoterPosition } from "./types";
type SpawnVoterArgs = {
    candidate: ResolvedVoterCandidate;
    prompt: string;
    parentSessionID: string;
    parentDirectory: string | undefined;
    voterTimeoutMs: number;
    reasoningEffort?: string;
};
export declare function spawnVoter(ctx: PluginInput, args: SpawnVoterArgs): Promise<VoterPosition>;
export declare function extractAssistantText(messages: ReadonlyArray<unknown>): string;
export declare const VOTER_SPAWNER_DEFAULTS: {
    readonly DEFAULT_VOTER_TIMEOUT_MS: 120000;
    readonly POLL_INTERVAL_MS: 1500;
    readonly STABILITY_REQUIRED_POLLS: 3;
    readonly DEFAULT_VOTER_REASONING_EFFORT: "high";
};
export {};
