import type { PluginInput } from "@opencode-ai/plugin";
import type { PendingTaskRef } from "./types";
export declare function createToolExecuteBeforeHandler(input: {
    ctx: PluginInput;
    pendingFilePaths: Map<string, string>;
    pendingTaskRefs: Map<string, PendingTaskRef>;
    pendingPlanSnapshots?: Map<string, string>;
    isCallerOrchestrator?: (sessionID: string | undefined) => Promise<boolean>;
}): (toolInput: {
    tool: string;
    sessionID?: string;
    callID?: string;
}, toolOutput: {
    args: Record<string, unknown>;
    message?: string;
}) => Promise<void>;
