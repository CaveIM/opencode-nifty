export declare const CAVE_MEISTER_INTERNAL_INITIATOR_MARKER = "<!-- CAVE_MEISTER_INTERNAL_INITIATOR -->";
export type InternalInitiatorTextPartLike = {
    type?: string;
    text?: string;
    synthetic?: boolean;
};
export type InternalInitiatorMessageLike = {
    role?: string;
    info?: {
        role?: string;
    };
    parts?: readonly InternalInitiatorTextPartLike[];
};
export declare function hasInternalInitiatorMarker(text: string): boolean;
export declare function isTextPartLike(part: InternalInitiatorTextPartLike): part is InternalInitiatorTextPartLike & {
    type: "text";
    text: string;
};
export declare function isSyntheticOrInternalTextPart(part: InternalInitiatorTextPartLike): boolean;
export declare function isRealUserTextPart(part: InternalInitiatorTextPartLike): part is InternalInitiatorTextPartLike & {
    type: "text";
    text: string;
};
export declare function isSyntheticOrInternalOnlyTextParts(parts: readonly InternalInitiatorTextPartLike[] | undefined): boolean;
export declare function isSyntheticOrInternalUserMessage(message: InternalInitiatorMessageLike): boolean;
export declare function isRealUserMessage(message: InternalInitiatorMessageLike): boolean;
export declare function stripInternalInitiatorMarkers(text: string): string;
export declare function createInternalAgentTextPart(text: string): {
    type: "text";
    text: string;
};
export declare function createInternalAgentContinuationTextPart(text: string): {
    type: "text";
    text: string;
    synthetic: true;
    metadata: {
        compaction_continue: true;
    };
};
