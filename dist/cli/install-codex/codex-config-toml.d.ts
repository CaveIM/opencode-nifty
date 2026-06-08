import type { CodexAgentConfig, CodexInstallPlatform, CodexMarketplaceSource, TrustedHookState } from "./types";
export declare function updateCodexConfig(input: {
    readonly configPath: string;
    readonly repoRoot: string;
    readonly marketplaceName: string;
    readonly marketplaceSource: CodexMarketplaceSource;
    readonly pluginNames: readonly string[];
    readonly platform?: CodexInstallPlatform;
    readonly trustedHookStates?: readonly TrustedHookState[];
    readonly agentConfigs?: readonly CodexAgentConfig[];
    readonly autonomousPermissions?: boolean;
}): Promise<void>;
