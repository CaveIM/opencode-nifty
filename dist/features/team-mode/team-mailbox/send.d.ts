import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { Message } from "../types";
type SendContext = {
    isLead: boolean;
    activeMembers: string[];
    reservedRecipients?: ReadonlySet<string>;
};
export declare class BroadcastNotPermittedError extends Error {
    constructor(message?: string);
}
export declare class PayloadTooLargeError extends Error {
    constructor(message?: string);
}
export declare class RecipientBackpressureError extends Error {
    constructor(message?: string);
}
export declare class DuplicateMessageIdError extends Error {
    constructor(message?: string);
}
export declare class TeamDeletingError extends Error {
    constructor(message?: string);
}
export declare function sendMessage(message: Message, teamRunId: string, config: TeamModeConfig, context: SendContext): Promise<{
    messageId: string;
    deliveredTo: string[];
}>;
export {};
