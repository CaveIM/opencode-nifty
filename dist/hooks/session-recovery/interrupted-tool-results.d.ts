import type { PluginInput } from "@opencode-ai/plugin";
import type { SessionRecoveryCallbacks } from "./hook-types";
export declare function createInterruptedToolResultsHandler(ctx: PluginInput, callbacks: SessionRecoveryCallbacks): (sessionID: string) => Promise<boolean>;
