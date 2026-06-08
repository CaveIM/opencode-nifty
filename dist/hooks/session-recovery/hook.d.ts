import type { PluginInput } from "@opencode-ai/plugin";
import type { SessionRecoveryHook, SessionRecoveryOptions } from "./hook-types";
export type { MessageInfo, SessionRecoveryHook, SessionRecoveryOptions } from "./hook-types";
export declare function createSessionRecoveryHook(ctx: PluginInput, options?: SessionRecoveryOptions): SessionRecoveryHook;
