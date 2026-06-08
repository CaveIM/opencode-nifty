import type { TmuxCommandResult } from "../runner";
type CloseTmuxPaneDependencies = {
    readonly isInsideTmux: () => boolean;
    readonly getTmuxPath: () => Promise<string | null | undefined>;
    readonly runTmuxCommand: (tmuxPath: string, args: string[]) => Promise<TmuxCommandResult>;
    readonly log: (message: string, data?: unknown) => void;
    readonly delay: (milliseconds: number) => Promise<void>;
};
export declare function closeTmuxPane(paneId: string): Promise<boolean>;
export declare function closeTmuxPaneWithDependencies(paneId: string, dependencies: CloseTmuxPaneDependencies): Promise<boolean>;
export {};
