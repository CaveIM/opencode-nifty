import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { RuntimeState } from "../types";
export declare function removeRuntimeDirectory(teamRunId: string, config: TeamModeConfig): Promise<boolean>;
export declare function cleanupMemberWorktrees(runtimeState: RuntimeState): Promise<void>;
