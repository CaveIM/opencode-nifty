import type { CodexInstallPlatform, TrustedHookState } from "./types";
export declare function ensurePluginEnabled(config: string, pluginKey: string): string;
export declare function ensureOmoBuiltinMcpPolicies(config: string, input: {
    readonly marketplaceName: string;
    readonly pluginNames: readonly string[];
    readonly platform?: CodexInstallPlatform;
}): string;
export declare function ensureHookTrusted(config: string, state: TrustedHookState): string;
