import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { RuntimeState } from "../types";
export declare function finishDeletingTeam(runtimeState: RuntimeState, config: TeamModeConfig): Promise<boolean>;
export declare function cleanTerminalTeam(runtimeState: RuntimeState, config: TeamModeConfig): Promise<boolean>;
