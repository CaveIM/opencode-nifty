export declare class MemberValidationError extends Error {
    readonly memberName?: string | undefined;
    readonly issue?: string | undefined;
    constructor(message: string, memberName?: string | undefined, issue?: string | undefined);
}
export declare function createParseMember<TMember>(memberSchema: {
    safeParse(input: unknown): {
        success: true;
        data: TMember;
    } | {
        success: false;
    };
}, agentEligibilityRegistry: Readonly<Record<string, {
    verdict: "eligible" | "conditional" | "hard-reject";
    rejectionMessage?: string;
}>>): (input: unknown) => TMember;
