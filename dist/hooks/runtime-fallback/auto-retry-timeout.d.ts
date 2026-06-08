import type { HookDeps } from "./types";
export declare function createFallbackTimeoutHelpers(deps: HookDeps, abortSessionRequest: (sessionID: string, source: string) => Promise<void>, autoRetryWithFallback: (sessionID: string, newModel: string, resolvedAgent: string | undefined, source: string) => Promise<void>): {
    clearSessionFallbackTimeout: (sessionID: string) => void;
    scheduleSessionFallbackTimeout: (sessionID: string, resolvedAgent?: string) => void;
};
