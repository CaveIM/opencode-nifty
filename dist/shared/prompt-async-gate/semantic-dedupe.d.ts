import type { InternalPromptDispatchResult } from "./types";
export declare function createSemanticPromptDedupeKey(input: unknown): string;
export declare function coalesceRecentSemanticPromptDispatch(args: {
    readonly sessionID: string;
    readonly dedupeKey: string;
    readonly source: string;
}): InternalPromptDispatchResult | undefined;
