import type { PluginInput } from "@opencode-ai/plugin";
import type { DefaultModeConfig } from "../../config/schema/default-mode";
import type { KeywordDetectorConfig } from "../../config/schema/keyword-detector";
import type { ContextCollector } from "../../features/context-injector";
import type { RalphLoopHook } from "../ralph-loop";
export declare function createKeywordDetectorHook(ctx: PluginInput, _collector?: ContextCollector, _ralphLoop?: Pick<RalphLoopHook, "startLoop">, config?: KeywordDetectorConfig, defaultMode?: DefaultModeConfig): {
    "chat.message": (input: {
        sessionID: string;
        agent?: string;
        model?: {
            providerID: string;
            modelID: string;
        };
        messageID?: string;
        variant?: string;
    }, output: {
        message: Record<string, unknown>;
        parts: Array<{
            type: string;
            text?: string;
            [key: string]: unknown;
        }>;
    }) => Promise<void>;
};
