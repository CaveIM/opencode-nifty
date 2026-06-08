import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types";
import type { RuntimeState } from "../types";
export type ActiveResumeOutcome = "resumed" | "marked_orphaned";
export declare function resumeActiveTeam(ctx: ExecutorContext, runtimeState: RuntimeState, config: TeamModeConfig, staleReservationTtlMs: number): Promise<ActiveResumeOutcome>;
