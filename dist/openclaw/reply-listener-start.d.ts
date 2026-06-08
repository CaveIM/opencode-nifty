import { type ReplyListenerDaemonState } from "./reply-listener-state";
import type { OpenClawConfig } from "./types";
export declare function resolveReplyListenerDaemonScript(currentFileUrl: string): string;
export declare function startReplyListener(config: OpenClawConfig): Promise<{
    success: boolean;
    message: string;
    state?: ReplyListenerDaemonState;
    error?: string;
}>;
