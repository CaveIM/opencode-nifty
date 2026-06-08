import type { ClaudeSettings } from "./types";
export declare function loadClaudeSettings(): ClaudeSettings | null;
export declare function isPluginEnabled(pluginKey: string, settingsEnabledPlugins: unknown, overrideEnabledPlugins: unknown): boolean;
