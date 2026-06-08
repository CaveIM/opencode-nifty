import { type PendingParentWake } from "./parent-wake-dedupe";
type ParentWakeDispatchedTrackerOptions = {
    readonly failureRequeueWindowMs: number;
    readonly onFailureRequeueWindowElapsed: (sessionID: string, wake: PendingParentWake) => void;
};
export declare class ParentWakeDispatchedTracker {
    private readonly options;
    private dispatchedParentWakes;
    private dispatchedParentWakeTimers;
    constructor(options: ParentWakeDispatchedTrackerOptions);
    getWakes(): Map<string, PendingParentWake>;
    getTimers(): Map<string, ReturnType<typeof setTimeout>>;
    getWake(sessionID: string): PendingParentWake | undefined;
    hasWake(sessionID: string): boolean;
    clearWake(sessionID: string): void;
    trackWake(sessionID: string, wake: PendingParentWake, dispatchedAt: number): void;
    refreshWakeTimer(sessionID: string): void;
    private scheduleFailureWindowTimer;
    shutdown(): void;
}
export {};
