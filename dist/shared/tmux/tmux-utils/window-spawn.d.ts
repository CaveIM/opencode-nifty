import type { TmuxConfig } from "../../../config/schema";
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver";
import type { SpawnPaneResult } from "../types";
import { isInsideTmux } from "./environment";
import { isServerRunning } from "./server-health";
import type { runTmuxCommand as RunTmuxCommand } from "../runner";
type SpawnTmuxWindowDeps = {
    log: (message: string, data?: unknown) => void;
    runTmuxCommand: typeof RunTmuxCommand;
    isInsideTmux: typeof isInsideTmux;
    isServerRunning: typeof isServerRunning;
    getTmuxPath: typeof getTmuxPath;
};
export declare function spawnTmuxWindow(sessionId: string, description: string, config: TmuxConfig, serverUrl: string, _directory: string, depsInput?: Partial<SpawnTmuxWindowDeps>): Promise<SpawnPaneResult>;
export {};
