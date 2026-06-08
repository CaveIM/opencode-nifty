import type { TeamModeConfig } from "../../../config/schema/team-mode";
export declare function ackMessages(teamRunId: string, memberName: string, messageIds: string[], config: TeamModeConfig): Promise<void>;
