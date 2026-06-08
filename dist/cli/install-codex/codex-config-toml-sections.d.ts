export interface TomlSection {
    readonly header: string | null;
    readonly text: string;
}
export declare function removeTomlSections(config: string, shouldRemove: (header: string) => boolean): string;
export declare function splitTomlSections(config: string): readonly TomlSection[];
export declare function parsePluginHeaderKey(header: string): string | null;
export declare function parseAgentHeaderName(header: string): string | null;
export declare function parseJsonString(value: string): string | null;
