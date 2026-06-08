import type { ParentWakeDispatchedTracker } from "./parent-wake-dispatched-tracker";
import type { ParentWakePendingQueue } from "./parent-wake-pending-queue";
import type { ParentWakeSessionInspector } from "./parent-wake-session-inspector";
import type { ParentWakeNotifierDeps } from "./parent-wake-notifier-types";
type ParentWakeFlushRunnerDeps = {
    readonly notifierDeps: ParentWakeNotifierDeps;
    readonly pendingQueue: ParentWakePendingQueue;
    readonly dispatchedTracker: ParentWakeDispatchedTracker;
    readonly sessionInspector: ParentWakeSessionInspector;
};
export declare class ParentWakeFlushRunner {
    private readonly deps;
    constructor(deps: ParentWakeFlushRunnerDeps);
    flushPendingParentWake(sessionID: string): Promise<void>;
    schedulePendingParentWakeFlush(sessionID: string, delayMs?: number): void;
    clearPendingParentWakeTimer(sessionID: string): void;
    private sendParentWakePrompt;
    private isSessionActive;
    private hasRecentParentSessionActivity;
    private isUserMessageInProgress;
    private shouldDeferParentWakeForSessionHistory;
    private requeueWake;
}
export {};
