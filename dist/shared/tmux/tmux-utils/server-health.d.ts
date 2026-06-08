export type ServerHealthState = {
    serverAvailable: boolean | null;
    serverCheckUrl: string | null;
    serverRunningInProcess: boolean;
};
type IsServerRunningOptions = {
    fetchImplementation?: typeof fetch;
    state?: ServerHealthState;
};
export declare function markServerRunningInProcess(): void;
export declare function createServerHealthStateForTesting(): ServerHealthState;
export declare function isServerRunning(serverUrl: string, options?: IsServerRunningOptions): Promise<boolean>;
export declare function resetServerCheck(): void;
export {};
