import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { Message } from "../types";
export declare function listUnreadMessages(teamRunId: string, memberName: string, config: TeamModeConfig): Promise<Message[]>;
