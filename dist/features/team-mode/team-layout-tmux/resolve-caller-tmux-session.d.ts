import type { TmuxCommandResult } from "../../../shared/tmux";
type ResolvedCallerTmuxSession = {
    sessionId: string;
    paneId: string;
    windowTarget: string;
};
type RunTmuxCommand = (tmuxPath: string, args: string[]) => Promise<TmuxCommandResult>;
export declare function resolveCallerTmuxSession(tmuxPath: string, callerPaneId?: string | undefined, runCommand?: RunTmuxCommand): Promise<ResolvedCallerTmuxSession | null>;
export {};
