import * as sharedTmuxModule from "../../../shared/tmux";
import * as tmuxPathResolverModule from "../../../tools/interactive-bash/tmux-path-resolver";
import type { TmuxSessionManager } from "../../tmux-subagent/manager";
import { resolveCallerTmuxSession } from "./resolve-caller-tmux-session";
type TeamLayoutMember = {
    name: string;
    sessionId: string;
    worktreePath?: string;
};
type TmuxCommandResult = Awaited<ReturnType<typeof sharedTmuxModule.runTmuxCommand>>;
export type TeamLayoutDeps = {
    runTmuxCommand: (tmuxPath: string, args: Array<string>, options?: Parameters<typeof sharedTmuxModule.runTmuxCommand>[2]) => Promise<TmuxCommandResult>;
    isServerRunning: typeof sharedTmuxModule.isServerRunning;
    getTmuxPath: typeof tmuxPathResolverModule.getTmuxPath;
    resolveCallerTmuxSession: typeof resolveCallerTmuxSession;
};
export type TeamLayoutResult = {
    focusWindowId: string;
    gridWindowId?: string;
    focusPanesByMember: Record<string, string>;
    gridPanesByMember: Record<string, string>;
    targetSessionId: string;
    ownedSession: boolean;
};
export type TeamLayoutCleanupTarget = {
    ownedSession: boolean;
    targetSessionId: string;
    focusWindowId?: string;
    gridWindowId?: string;
    paneIds?: Array<string>;
};
export declare function canVisualize(): boolean;
export declare function createTeamLayout(teamRunId: string, members: Array<TeamLayoutMember>, tmuxMgr: TmuxSessionManager, deps?: TeamLayoutDeps): Promise<TeamLayoutResult | null>;
export declare function removeTeamLayout(teamRunId: string, tmuxMgrOrCleanupTarget: TmuxSessionManager | TeamLayoutCleanupTarget | undefined, tmuxMgrOrDeps?: TmuxSessionManager | TeamLayoutDeps, deps?: TeamLayoutDeps): Promise<void>;
export {};
