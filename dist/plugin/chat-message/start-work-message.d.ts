import type { ChatMessageHooks, ChatMessageInput, ChatMessageHandlerOutput, StartWorkHookOutput, WorkStartingCommand } from "./types";
export declare function isStartWorkHookOutput(value: unknown): value is StartWorkHookOutput;
export declare function isStartWorkFallbackTemplate(promptText: string): boolean;
export declare function clearStoppedContinuationBeforeWorkStart(hooks: ChatMessageHooks, sessionID: string, command: WorkStartingCommand): void;
export declare function runStartWorkHookIfApplicable(hooks: ChatMessageHooks, input: ChatMessageInput, output: ChatMessageHandlerOutput): Promise<void>;
