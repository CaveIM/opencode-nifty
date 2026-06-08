import type { Member, TeamSpec } from "../types";
export declare class TeamSpecValidationError extends Error {
    readonly code: string;
    readonly field?: string | undefined;
    readonly memberName?: string | undefined;
    constructor(message: string, code: string, field?: string | undefined, memberName?: string | undefined);
}
export declare function validateSpec(spec: TeamSpec): void;
export declare function validateMemberEligibility(member: Member): void;
export declare function validateDualSupport(member: Member): void;
