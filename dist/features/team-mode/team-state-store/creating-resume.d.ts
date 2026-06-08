import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { RuntimeState } from "../types";
export declare function isCreatingStateStuck(runtimeState: RuntimeState, now: number, creatingTimeoutMs: number): boolean;
export declare function markStuckCreatingTeamFailed(runtimeState: RuntimeState, config: TeamModeConfig): Promise<void>;
