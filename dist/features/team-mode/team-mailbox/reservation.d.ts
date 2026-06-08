import type { TeamModeConfig } from "../../../config/schema/team-mode";
export interface DeliveryReservation {
    reservedPath: string;
    inboxPath: string;
    processedPath: string;
    processedDir: string;
}
export declare function reserveMessageForDelivery(teamRunId: string, recipientName: string, messageId: string, config: TeamModeConfig): Promise<DeliveryReservation | null>;
export declare function commitDeliveryReservation(reservation: DeliveryReservation): Promise<void>;
export declare function releaseDeliveryReservation(reservation: DeliveryReservation): Promise<void>;
export declare function reclaimStaleReservations(teamRunId: string, recipientName: string, config: TeamModeConfig, staleTtlMs: number): Promise<string[]>;
