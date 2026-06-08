import { type ReplyListenerDaemonState } from "./reply-listener-state";
export declare function shouldContinuePolling(state: ReplyListenerDaemonState): boolean;
export declare function pollLoop(): Promise<void>;
