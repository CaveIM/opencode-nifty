import type { MessageData } from "./types";
export declare function assistantMessageIsFinished(message: MessageData): boolean;
export declare function messageHasInterruptedToolResults(message: MessageData): boolean;
export declare function findLatestAssistantMessage(messages: MessageData[]): MessageData | undefined;
