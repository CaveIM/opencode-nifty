import type { LoadedPlugin, PluginInstallation, PluginManifest } from "./types";
export declare function createLoadedPlugin(pluginKey: string, installation: PluginInstallation, installPath: string, manifest: PluginManifest | null): LoadedPlugin;
