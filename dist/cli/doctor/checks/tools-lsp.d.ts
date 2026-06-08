type InstalledLspServersOptions = {
    readonly configDirectory?: string;
    readonly cwd?: string;
};
export declare function getInstalledLspServers(options?: InstalledLspServersOptions): Array<{
    id: string;
    extensions: string[];
}>;
export {};
