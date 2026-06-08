export type SweepTmuxSessionsDeps = {
    isInsideTmux: () => boolean;
    getTmuxPath: () => Promise<string | null | undefined>;
    listCandidateSessions: (tmux: string) => Promise<string[]>;
    killSession: (sessionName: string) => Promise<boolean>;
    log: (message: string, payload?: unknown) => void;
};
export type SweepDeps = SweepTmuxSessionsDeps & {
    processAlive: (pid: number) => boolean;
    currentPid: number;
};
export type SweepTmuxSessionsOptions = {
    prefix?: string;
    predicate?: (sessionName: string) => boolean;
};
export declare function sweepTmuxSessionsWith(deps: SweepTmuxSessionsDeps, options: SweepTmuxSessionsOptions): Promise<string[]>;
export declare function sweepStaleOmoAgentSessionsWith(deps: SweepDeps): Promise<number>;
export declare function sweepStaleOmoAgentSessions(): Promise<number>;
