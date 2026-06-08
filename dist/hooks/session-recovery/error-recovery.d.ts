import type { PluginInput } from "@opencode-ai/plugin";
import type { ExperimentalConfig } from "../../config";
import type { MessageInfo, SessionRecoveryCallbacks } from "./hook-types";
export declare function createSessionErrorRecoveryHandler(ctx: PluginInput, callbacks: SessionRecoveryCallbacks, experimental?: ExperimentalConfig): (info: MessageInfo) => Promise<boolean>;
