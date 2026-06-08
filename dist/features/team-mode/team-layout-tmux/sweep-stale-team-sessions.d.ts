export declare const TEAM_SESSION_PATTERN: RegExp;
export type TeamSweepDeps = {
    listCandidates: () => Promise<string[]>;
    killSession: (name: string) => Promise<void>;
    log: (message: string, payload?: unknown) => void;
};
export declare function sweepStaleTeamSessionsWith(activeTeamRunIds: ReadonlySet<string>, deps: TeamSweepDeps): Promise<string[]>;
export declare function sweepStaleTeamSessions(activeTeamRunIds: ReadonlySet<string>): Promise<string[]>;
