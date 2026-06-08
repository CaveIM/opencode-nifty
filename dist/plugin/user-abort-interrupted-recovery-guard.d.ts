export type UserAbortInterruptedRecoveryGuard = {
    readonly noteSessionError: (sessionID: string, errorName: string | undefined) => boolean;
    readonly shouldSkipRecovery: (sessionID: string) => boolean;
    readonly clear: (sessionID: string) => void;
};
export declare function createUserAbortInterruptedRecoveryGuard(): UserAbortInterruptedRecoveryGuard;
