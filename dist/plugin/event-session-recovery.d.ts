import type { CreatedHooks } from "../create-hooks";
import type { PluginEventContext } from "./event-types";
export declare function handleRecoverableSessionError(args: {
    hooks: CreatedHooks;
    pluginContext: PluginEventContext;
    sessionID?: string;
    messageID?: string;
    error: unknown;
}): Promise<boolean>;
