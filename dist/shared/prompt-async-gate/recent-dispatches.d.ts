type RecentPromptDispatch = {
    readonly source: string;
    readonly expiresAt: number;
};
export declare function getRecentPromptDispatch(sessionID: string, dedupeKey: string): RecentPromptDispatch | undefined;
export declare function rememberRecentPromptDispatch(args: {
    readonly sessionID: string;
    readonly dedupeKey: string;
    readonly source: string;
    readonly holdMs: number;
}): void;
export declare function deleteRecentPromptDispatch(sessionID: string, dedupeKey: string): void;
export declare function removeRecentDispatchesForSession(sessionID: string): void;
export declare function clearRecentPromptDispatchesForTesting(): void;
export {};
