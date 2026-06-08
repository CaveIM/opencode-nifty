export { createContentHash, getMatcherCacheStats, isDuplicateByContentHash, isDuplicateByRealPath, resetMatcherCache, shouldApplyRule, } from "@cave-meister/rules-engine";
export type { MatchResult } from "@cave-meister/rules-engine";
export interface MatcherCacheStats {
    readonly entries: number;
}
