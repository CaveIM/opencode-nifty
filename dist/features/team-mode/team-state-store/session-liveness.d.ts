import type { ExecutorContext } from "../../../tools/delegate-task/executor-types";
import type { RuntimeState } from "../types";
export interface WorkerLiveness {
    readonly name: string;
    readonly wasSpawned: boolean;
    readonly stillAlive: boolean;
}
export declare function sessionExists(ctx: ExecutorContext, sessionId: string): Promise<boolean>;
export declare function inspectWorkerMembers(ctx: ExecutorContext, runtimeState: RuntimeState): Promise<WorkerLiveness[]>;
