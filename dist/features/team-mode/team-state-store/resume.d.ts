import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types";
import type { ResumeReport } from "./resume-report";
export type { ResumeReport } from "./resume-report";
export declare function resumeAllTeams(ctx: ExecutorContext, config: TeamModeConfig): Promise<ResumeReport>;
