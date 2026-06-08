import type { PluginManifest } from "./types";
export declare function findPluginManifestPath(installPath: string): string | null;
export declare function loadPluginManifest(installPath: string): PluginManifest | null;
export declare function readManifestFromPath(manifestPath: string): PluginManifest | null;
