import type { PluginInput } from "@opencode-ai/plugin";
type SdkSession = PluginInput["client"]["session"];
type SdkPromptAsync = SdkSession["promptAsync"];
type SdkStatus = SdkSession["status"];
export type TeamIdleWakeHintNarrowClient = {
    session: {
        promptAsync?: SdkPromptAsync;
        status?: SdkStatus;
    };
};
export declare function buildTeamIdleWakeHintClient(client: PluginInput["client"]): TeamIdleWakeHintNarrowClient;
export {};
