import type { InternalPromptDispatchResult, QueuedInternalPrompt } from "./types";
export declare function schedulePromptQueueDrain(sessionID: string, delayMs: number): void;
export declare function getQueuedPromptBlocker(sessionID: string): string | undefined;
export declare function isPromptQueueDraining(sessionID: string): boolean;
export declare function nextPromptQueueID(): number;
export declare function releaseInFlightPromptMatchingDedupe(sessionID: string, dedupeKey: string): void;
export declare function clearPromptQueueStateForTesting(): void;
export declare function enqueueInternalPrompt(entry: QueuedInternalPrompt): Promise<InternalPromptDispatchResult>;
