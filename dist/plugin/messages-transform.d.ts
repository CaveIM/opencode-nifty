import type { Message, Part } from "@opencode-ai/sdk";
import type { CreatedHooks } from "../create-hooks";
type MessageWithParts = {
    info: Message;
    parts: Part[];
};
type MessagesTransformOutput = {
    messages: MessageWithParts[];
};
type MessagesTransformHooks = {
    projectBrain?: CreatedHooks["projectBrain"];
    contextInjectorMessagesTransform?: CreatedHooks["contextInjectorMessagesTransform"];
    teamModeStatusInjector?: CreatedHooks["teamModeStatusInjector"];
    teamMailboxInjector?: CreatedHooks["teamMailboxInjector"];
    thinkingBlockValidator?: CreatedHooks["thinkingBlockValidator"];
    toolPairValidator?: CreatedHooks["toolPairValidator"];
};
export declare function createMessagesTransformHandler(args: {
    hooks: MessagesTransformHooks;
}): (input: Record<string, never>, output: MessagesTransformOutput) => Promise<void>;
export {};
