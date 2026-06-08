import type { FallbackEntry } from "./model-requirements";
export type ModelLineage = string;
export declare function getModelLineage(modelId: string | undefined): ModelLineage | undefined;
export declare function getCallerLineageGroup(modelId: string | undefined): Set<ModelLineage>;
export type VoterCandidate = {
    lineage: ModelLineage;
    entry: FallbackEntry;
};
export declare function getDefaultVoterPool(): ReadonlyArray<VoterCandidate>;
export type PickVotersOptions = {
    callerModel?: string;
    excludeLineages?: ReadonlyArray<ModelLineage>;
    count?: number;
    pool?: ReadonlyArray<VoterCandidate>;
};
export declare function pickDiverseVoters(options?: PickVotersOptions): VoterCandidate[];
