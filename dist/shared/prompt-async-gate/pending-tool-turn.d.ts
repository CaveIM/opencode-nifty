import type { PromptDispatchClient, PromptSessionName } from "./types";
export declare function latestAssistantTurnHasUnansweredQuestion(messages: unknown[]): boolean;
export declare function latestAssistantTurnBlocksInternalPrompt(messages: unknown[]): boolean;
export declare function sessionLatestAssistantBlocksInternalPrompt<TInput>(args: {
    readonly client: PromptDispatchClient;
    readonly sessionID: string;
    readonly input: TInput;
    readonly sessionName: PromptSessionName;
    readonly source: string;
    readonly timeoutMs: number;
}): Promise<boolean>;
