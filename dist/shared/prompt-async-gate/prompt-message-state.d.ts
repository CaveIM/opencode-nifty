export declare function messageRole(message: unknown): string | undefined;
export declare function messageFinish(message: unknown): string | true | undefined;
export declare function messageCompleted(message: unknown): boolean;
export declare function messageIsSyntheticOrInternalUser(message: unknown): boolean;
export declare function messageHasQuestionTool(message: unknown): boolean;
export declare function messageHasWaitingTool(message: unknown): boolean;
export declare function messageHasUnresolvedTool(message: unknown): boolean;
export declare function messageHasSubstantiveAssistantOutput(message: unknown): boolean;
