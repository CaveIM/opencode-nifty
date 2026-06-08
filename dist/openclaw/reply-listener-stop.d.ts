import { type ReplyListenerDaemonState } from "./reply-listener-state";
export declare function stopReplyListener(): Promise<{
    success: boolean;
    message: string;
    state?: ReplyListenerDaemonState;
    error?: string;
}>;
