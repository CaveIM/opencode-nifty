import type { PendingParentWake } from "./parent-wake-dedupe";
export type ParentWakeSessionMessage = {
    readonly info?: {
        readonly role?: string;
        readonly finish?: string;
        readonly error?: unknown;
        readonly time?: {
            readonly created?: unknown;
            readonly updated?: unknown;
            readonly completed?: unknown;
            readonly start?: unknown;
            readonly end?: unknown;
        };
    };
    readonly role?: string;
    readonly finish?: string;
    readonly error?: unknown;
    readonly time?: {
        readonly created?: unknown;
        readonly updated?: unknown;
        readonly completed?: unknown;
        readonly start?: unknown;
        readonly end?: unknown;
    };
    readonly parts?: readonly {
        readonly type?: string;
        readonly text?: string;
        readonly synthetic?: boolean;
        readonly content?: unknown;
        readonly time?: {
            readonly created?: unknown;
            readonly updated?: unknown;
            readonly completed?: unknown;
            readonly start?: unknown;
            readonly end?: unknown;
        };
        readonly state?: {
            readonly status?: unknown;
            readonly time?: {
                readonly created?: unknown;
                readonly updated?: unknown;
                readonly completed?: unknown;
                readonly start?: unknown;
                readonly end?: unknown;
            };
        };
    }[];
};
export type ToolWaitDeferralDecision = {
    readonly defer: boolean;
    readonly skipPromptGateToolStateCheck: boolean;
};
export declare function parentWakeUserMessageIsInProgress(input: {
    readonly messages: readonly ParentWakeSessionMessage[] | undefined;
    readonly windowMs: number;
    readonly now?: number;
}): boolean;
export declare function getParentWakeSessionHistoryDeferralDecision(input: {
    readonly sessionID: string;
    readonly messages: readonly ParentWakeSessionMessage[] | undefined;
    readonly wake: PendingParentWake;
    readonly toolCallDeferMaxMs: number;
    readonly now?: number;
}): ToolWaitDeferralDecision;
export declare function hasRecordedParentWakePromptMessage(input: {
    readonly messages: readonly ParentWakeSessionMessage[] | undefined;
    readonly wake: PendingParentWake;
    readonly acceptedMessageSkewMs: number;
}): boolean;
export declare function hasAssistantOrToolOutputAfterParentWake(input: {
    readonly messages: readonly ParentWakeSessionMessage[] | undefined;
    readonly wake: PendingParentWake;
}): boolean;
