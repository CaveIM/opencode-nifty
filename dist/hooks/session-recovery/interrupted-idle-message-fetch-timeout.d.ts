export declare const DEFAULT_INTERRUPTED_IDLE_MESSAGES_FETCH_TIMEOUT_MS = 5000;
export declare function _setInterruptedIdleMessagesFetchTimeoutMsForTesting(value: number | undefined): void;
export declare function getInterruptedIdleMessagesFetchTimeoutMs(): number;
export declare class InterruptedIdleMessagesFetchTimeoutError extends Error {
    constructor(timeoutMs: number);
}
export declare function withInterruptedIdleMessagesFetchTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T>;
