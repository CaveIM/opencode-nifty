import type { TeamModeConfig } from "../../../config/schema/team-mode";
import { buildEnvelope } from "../team-mailbox/poll";
import type { Message, RuntimeState } from "../types";
import type { LiveDeliveryClient } from "./messaging-live-delivery-client";
import type { DeliveryReservation } from "./messaging-live-delivery-reservation";
type RuntimeMember = RuntimeState["members"][number];
type LiveDeliveryEnvelope = ReturnType<typeof buildEnvelope>;
export declare function deliverLiveToRecipient(input: {
    client: LiveDeliveryClient;
    message: Message;
    envelope: LiveDeliveryEnvelope;
    teamRunId: string;
    recipientName: string;
    recipientMember: RuntimeMember;
    reservation: DeliveryReservation;
    config: TeamModeConfig;
    directory: string;
}): Promise<void>;
export {};
