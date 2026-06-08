import type { createOpencodeClient } from "@opencode-ai/sdk";
import type { MessageData, ResumeConfig } from "./types";
type Client = ReturnType<typeof createOpencodeClient>;
export type RecoverToolResultMissingOptions = {
    recoverStatuses?: ReadonlySet<string>;
    resultText?: string;
    source?: string;
};
export declare function recoverToolResultMissing(client: Client, sessionID: string, failedAssistantMsg: MessageData, resumeConfig?: ResumeConfig, options?: RecoverToolResultMissingOptions): Promise<boolean>;
export {};
