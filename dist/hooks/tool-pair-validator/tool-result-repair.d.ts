import type { MessageWithParts, TransformMessageInfo } from "./types";
export declare function getMessageSessionID(message: TransformMessageInfo): string | undefined;
export declare function repairSubAgentMissingToolResults(messages: MessageWithParts[], assistantIndex: number, sessionID: string): void;
export declare function repairMissingToolResults(messages: MessageWithParts[], assistantIndex: number): void;
