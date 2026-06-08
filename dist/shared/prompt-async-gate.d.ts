import { removeRecentDispatchesForSession } from "./prompt-async-gate/recent-dispatches";
import type { InternalPromptDispatchArgs, InternalPromptDispatchResult, PromptAsyncInput, PromptAsyncReservationReleaseOptions } from "./prompt-async-gate/types";
export { DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS, DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS, DEFAULT_PROMPT_GATE_MESSAGES_FETCH_TIMEOUT_MS, DEFAULT_PROMPT_QUEUE_RETRY_MS, DEFAULT_PROMPT_SEMANTIC_DEDUPE_HOLD_MS, _setPromptGateMessagesFetchTimeoutMsForTesting, } from "./prompt-async-gate/timing";
export type { InternalPromptDispatchArgs, InternalPromptDispatchMode, InternalPromptDispatchResult, InternalPromptQueueBehavior, PromptAsyncGateResult, } from "./prompt-async-gate/types";
export declare function dispatchInternalPrompt<TInput = PromptAsyncInput>(args: InternalPromptDispatchArgs<TInput>): Promise<InternalPromptDispatchResult>;
export declare function releaseAllPromptAsyncReservationsForTesting(): void;
export declare function isInternalPromptDispatchAccepted(result: InternalPromptDispatchResult): boolean;
export declare function releasePromptAsyncReservation(sessionID: string, source: string, options?: PromptAsyncReservationReleaseOptions): boolean;
export { removeRecentDispatchesForSession };
