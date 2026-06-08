import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { Message } from "../types";
export interface InjectionResult {
    injected: boolean;
    content?: string;
    messageIds: string[];
    reason?: string;
}
export declare function buildEnvelope(message: Message): string;
export declare function pollAndBuildInjection(sessionID: string, memberName: string, teamRunId: string, config: TeamModeConfig, turnMarker: string): Promise<InjectionResult>;
