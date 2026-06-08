import type { OhMyOpenCodeConfig } from "../../config";
import type { ChatMessageHooks, ChatMessageHandlerOutput, ChatMessageInput } from "./types";
export declare function handleRalphLoopMessage(args: {
    readonly hooks: ChatMessageHooks;
    readonly input: ChatMessageInput;
    readonly output: ChatMessageHandlerOutput;
    readonly isFirstMessage: boolean;
    readonly pluginConfig: OhMyOpenCodeConfig;
}): void;
