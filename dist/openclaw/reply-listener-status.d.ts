export declare function terminateReplyListenerProcess(pid: number): Promise<void>;
export declare function isDaemonRunning(): Promise<boolean>;
export declare function waitForDaemonToStop(timeoutMs: number): Promise<boolean>;
export declare function waitForReplyListenerProcessExit(pid: number, timeoutMs: number): Promise<boolean>;
