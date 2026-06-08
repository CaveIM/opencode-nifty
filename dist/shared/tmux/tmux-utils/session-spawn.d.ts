import type { TmuxConfig } from "../../../config/schema";
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver";
import type { SpawnPaneResult } from "../types";
import type { runTmuxCommand as RunTmuxCommand } from "../runner";
import { isInsideTmux } from "./environment";
import { isServerRunning } from "./server-health";
type SpawnTmuxSessionDeps = {
    log: (message: string, data?: unknown) => void;
    runTmuxCommand: typeof RunTmuxCommand;
    isInsideTmux: typeof isInsideTmux;
    isServerRunning: typeof isServerRunning;
    getTmuxPath: typeof getTmuxPath;
};
export declare function getIsolatedSessionName(pid?: number, managerId?: string): string;
export declare function spawnTmuxSession(sessionId: string, description: string, config: TmuxConfig, serverUrl: string, _directory: string, sourcePaneId?: string, depsInput?: Partial<SpawnTmuxSessionDeps>, managerId?: string): Promise<SpawnPaneResult>;
export {};
