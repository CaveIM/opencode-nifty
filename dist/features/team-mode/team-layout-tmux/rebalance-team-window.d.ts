export type RebalanceLayout = "main-vertical" | "tiled";
export type RebalanceTeamWindowDeps = {
    runTmux: (args: string[]) => Promise<{
        success: boolean;
    }>;
    log: (message: string, meta?: Record<string, unknown>) => void;
};
export declare function rebalanceTeamWindowWith(windowId: string, layout: RebalanceLayout, deps: RebalanceTeamWindowDeps): Promise<boolean>;
export declare function rebalanceTeamWindow(windowId: string, layout: RebalanceLayout): Promise<boolean>;
