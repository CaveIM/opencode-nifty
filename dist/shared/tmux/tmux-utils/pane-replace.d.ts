import type { TmuxConfig } from "../../../config/schema";
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver";
import type { SpawnPaneResult } from "../types";
import type { runTmuxCommand as RunTmuxCommand } from "../runner";
import { isInsideTmux } from "./environment";
type ReplaceTmuxPaneDeps = {
    log: (message: string, data?: unknown) => void;
    runTmuxCommand: typeof RunTmuxCommand;
    isInsideTmux: typeof isInsideTmux;
    getTmuxPath: typeof getTmuxPath;
};
export declare function replaceTmuxPane(paneId: string, sessionId: string, description: string, config: TmuxConfig, _serverUrl: string, _directory: string, depsInput?: Partial<ReplaceTmuxPaneDeps>): Promise<SpawnPaneResult>;
export {};
