import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types";
import type { RuntimeStateMember } from "../types";
export declare function reconcileStaleReservationsForMember(ctx: ExecutorContext, teamRunId: string, member: RuntimeStateMember, config: TeamModeConfig, staleReservationTtlMs: number): Promise<void>;
