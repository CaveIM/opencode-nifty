import type { PromptAsyncReservation, PromptAsyncReservationReleaseOptions } from "./types";
export declare function setExpiredReservationHandler(handler: (sessionID: string) => void): void;
export declare function getActiveReservation(sessionID: string): PromptAsyncReservation | undefined;
export declare function getPromptReservation(sessionID: string): PromptAsyncReservation | undefined;
export declare function setPromptReservation(sessionID: string, reservation: PromptAsyncReservation): void;
export declare function finishPromptReservation(sessionID: string, reservation: PromptAsyncReservation, dispatchAttempted: boolean, postDispatchHoldMs: number): void;
export declare function deletePromptReservation(sessionID: string): void;
export declare function clearPromptReservationsForTesting(): void;
export declare function reservationSourceMatches(reservationSource: string, expectedSource: string | readonly string[], expectedPrefix?: PromptAsyncReservationReleaseOptions["reservedByPrefix"]): boolean;
