import type { InstalledPlugin, RunCommand } from "./types";
type RenameDirectory = (fromPath: string, toPath: string) => Promise<void>;
export declare function installCachedPlugin(input: {
    readonly buildSource?: boolean;
    readonly codexHome: string;
    readonly marketplaceName: string;
    readonly name: string;
    readonly renameDirectory?: RenameDirectory;
    readonly sourcePath: string;
    readonly version: string;
    readonly runCommand: RunCommand;
}): Promise<InstalledPlugin>;
export {};
