import type { InternalPromptDispatchResult, PromptDispatchClient, PromptSessionName } from "./types";
export declare function dispatchAfterSessionIdle<TInput>(args: {
    readonly sessionName: PromptSessionName;
    readonly client: PromptDispatchClient;
    readonly sessionID: string;
    readonly input: TInput;
    readonly source: string;
    readonly dedupeKey: string;
    readonly settleMs: number;
    readonly postDispatchHoldMs: number;
    readonly semanticDedupeHoldMs: number;
    readonly dispatchTimeoutMs: number;
    readonly checkStatus: boolean;
    readonly checkToolState: boolean;
    readonly dispatch: (input: TInput) => Promise<unknown>;
}): Promise<InternalPromptDispatchResult>;
