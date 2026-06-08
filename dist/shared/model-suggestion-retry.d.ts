import type { createOpencodeClient } from "@opencode-ai/sdk";
import { parseModelSuggestion as parseModelSuggestionFromCore } from "@cave-meister/model-core";
import { type PromptRetryOptions } from "./prompt-timeout-context";
type Client = ReturnType<typeof createOpencodeClient>;
export type { ModelSuggestionInfo } from "@cave-meister/model-core";
export { parseModelSuggestionFromCore as parseModelSuggestion };
interface PromptBody {
    model?: {
        providerID: string;
        modelID: string;
    };
    [key: string]: unknown;
}
interface PromptArgs {
    path: {
        id: string;
    };
    body: PromptBody;
    signal?: AbortSignal;
    [key: string]: unknown;
}
export declare function promptWithModelSuggestionRetry(client: Client, args: PromptArgs, options?: PromptRetryOptions): Promise<void>;
export declare function promptSyncWithModelSuggestionRetry(client: Client, args: PromptArgs, options?: PromptRetryOptions): Promise<void>;
