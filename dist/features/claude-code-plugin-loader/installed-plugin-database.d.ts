import type { InstalledPluginsDatabase, PluginInstallation } from "./types";
export declare function loadInstalledPlugins(pluginsBaseDir?: string): InstalledPluginsDatabase | null;
export declare function extractPluginEntries(db: InstalledPluginsDatabase): Array<[string, PluginInstallation | undefined]>;
