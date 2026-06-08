import type { TmuxConfig } from "../../../config/schema";
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver";
import type { SpawnPaneResult } from "../types";
import type { runTmuxCommand as RunTmuxCommand } from "../runner";
import type { SplitDirection } from "./environment";
import { isInsideTmux } from "./environment";
import { isServerRunning } from "./server-health";
type SpawnTmuxPaneDeps = {
    log: (message: string, data?: unknown) => void;
    runTmuxCommand: typeof RunTmuxCommand;
    isInsideTmux: typeof isInsideTmux;
    isServerRunning: typeof isServerRunning;
    getTmuxPath: typeof getTmuxPath;
};
export declare function spawnTmuxPane(sessionId: string, description: string, config: TmuxConfig, serverUrl: string, _directory: string, targetPaneId?: string, splitDirection?: SplitDirection, depsInput?: Partial<SpawnTmuxPaneDeps>): Promise<SpawnPaneResult>;
export {};
