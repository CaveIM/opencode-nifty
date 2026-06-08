type RunTmuxOptions = {
    retry?: number;
    timeoutMs?: number;
};
export type TmuxCommandResult = {
    success: boolean;
    output: string;
    stdout: string;
    stderr: string;
    exitCode: number;
};
export declare function runTmuxCommand(tmuxPath: string, args: string[], options?: RunTmuxOptions): Promise<TmuxCommandResult>;
export {};
