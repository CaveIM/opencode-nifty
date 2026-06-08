import type { TrustedHookState } from "./types";
export declare function trustedHookStatesForPlugin(input: {
    readonly marketplaceName: string;
    readonly pluginName: string;
    readonly pluginRoot: string;
}): Promise<readonly TrustedHookState[]>;
