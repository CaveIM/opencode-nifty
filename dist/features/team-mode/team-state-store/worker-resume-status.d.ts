import type { RuntimeState } from "../types";
import type { WorkerLiveness } from "./session-liveness";
export interface WorkerResumeStatus {
    readonly deadWorkerNames: readonly string[];
    readonly hasAliveWorker: boolean;
    readonly hasAnyWorker: boolean;
}
export declare function summarizeWorkerLiveness(workerCheckResults: readonly WorkerLiveness[]): WorkerResumeStatus;
export declare function markDeadWorkersErrored(runtimeState: RuntimeState, deadWorkerNames: readonly string[]): RuntimeState;
