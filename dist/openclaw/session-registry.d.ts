import type { SessionMapping } from "./session-registry-types";
export type { SessionMapping } from "./session-registry-types";
export declare function registerMessage(mapping: SessionMapping): boolean;
export declare function loadAllMappings(): SessionMapping[];
export declare function lookupByMessageId(platform: string, messageId: string): SessionMapping | null;
export declare function removeSession(sessionId: string): void;
export declare function removeMessagesByPane(paneId: string): void;
export declare function pruneStale(): void;
