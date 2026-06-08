export declare const DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS = 2000;
export declare const DEFAULT_PROMPT_SEMANTIC_DEDUPE_HOLD_MS = 15000;
export declare const DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS = 30000;
export declare const DEFAULT_PROMPT_GATE_MESSAGES_FETCH_TIMEOUT_MS = 5000;
export declare const DEFAULT_PROMPT_QUEUE_RETRY_MS = 250;
export declare function _setPromptGateMessagesFetchTimeoutMsForTesting(value: number | undefined): void;
export declare function getPromptGateMessagesFetchTimeoutMs(): number;
export declare function resetPromptGateTimingForTesting(): void;
export declare function withDispatchTimeout<T>(operation: Promise<T>, dispatchTimeoutMs: number, operationName: string): Promise<T>;
