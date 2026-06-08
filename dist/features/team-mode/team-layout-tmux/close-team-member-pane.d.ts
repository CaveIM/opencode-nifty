import type { RuntimeStateMember } from "../types";
type TeamMemberPaneIds = Pick<RuntimeStateMember, "tmuxPaneId" | "tmuxGridPaneId">;
export declare function closeTeamMemberPane(member: TeamMemberPaneIds): Promise<boolean>;
export {};
