type ToolExecuteInput = {
    tool: string;
    sessionID: string;
    callID: string;
};
type ToolBeforeOutput = {
    args: Record<string, unknown>;
};
type ToolAfterOutput = {
    title: string;
    output: string;
    metadata: unknown;
};
export declare function createFsyncSkipWarningHook(): {
    "tool.execute.before": (input: ToolExecuteInput, _output: ToolBeforeOutput) => Promise<void>;
    "tool.execute.after": (input: ToolExecuteInput, output: ToolAfterOutput) => Promise<void>;
};
export {};
