import type { VoterCandidate } from "../../shared/model-lineage";
import type { ResolvedVoterCandidate } from "./types";
export declare function resolveVoterCandidate(candidate: VoterCandidate, connectedProviders: ReadonlySet<string>, availableModels: Set<string>): ResolvedVoterCandidate | null;
