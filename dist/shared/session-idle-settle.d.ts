export declare const DEFAULT_SESSION_IDLE_SETTLE_MS = 150;
export declare const DEFAULT_SESSION_STATUS_TIMEOUT_MS = 5000;
export declare function settleAfterSessionIdle(ms?: number): Promise<void>;
type SessionStatusClient = {
    session?: {
        status?: () => Promise<unknown>;
    };
};
export declare function isActiveSessionStatusType(statusType: string): boolean;
export declare function isSessionActive(client: SessionStatusClient, sessionID: string, statusTimeoutMs?: number): Promise<boolean>;
export declare function shouldPromptAfterSessionIdle(client: SessionStatusClient, sessionID: string, settleMs?: number): Promise<boolean>;
export {};
