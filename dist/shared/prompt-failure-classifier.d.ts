export declare function extractPromptFailureMessage(error: unknown): string;
export declare function isAmbiguousPromptDispatchFailure(error: unknown): boolean;
type PromptDispatchFailureResultLike = {
    status: "failed";
    error: unknown;
    dispatchAttempted?: boolean;
};
export declare function isAmbiguousPostDispatchPromptFailure(result: PromptDispatchFailureResultLike): boolean;
export {};
