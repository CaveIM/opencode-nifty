import type { PluginInput } from "@opencode-ai/plugin";
type OpencodeClient = PluginInput["client"];
export declare function isLatestAssistantMessage(sessionID: string, messageID: string): boolean;
export declare function isLatestAssistantMessageFromSDK(client: OpencodeClient, sessionID: string, messageID: string): Promise<boolean>;
export {};
