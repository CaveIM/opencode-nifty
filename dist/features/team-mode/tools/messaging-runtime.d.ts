import type { TeamModeConfig } from "../../../config/schema/team-mode";
import { loadRuntimeState } from "../team-state-store/store";
import type { Message, RuntimeState } from "../types";
export type TeamRuntimeDetails = {
    teamRunId: string;
    isLead: boolean;
    senderName: string;
    activeMembers: string[];
};
export type TeamSendMessageToolDeps = {
    loadRuntimeState: typeof loadRuntimeState;
};
export declare const defaultTeamSendMessageToolDeps: TeamSendMessageToolDeps;
type RuntimeMember = RuntimeState["members"][number];
export declare function shouldReserveRecipientMailbox(member: RuntimeMember, message: Message, senderName: string): boolean;
export declare function resolveTeamRuntimeDetails(teamRunId: string, sessionID: string, config: TeamModeConfig, deps: TeamSendMessageToolDeps): Promise<TeamRuntimeDetails>;
export {};
