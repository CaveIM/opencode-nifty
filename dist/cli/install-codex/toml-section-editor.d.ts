export interface TomlSection {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}
export declare function findTomlSection(config: string, header: string): TomlSection | null;
export declare function replaceOrInsertSetting(config: string, section: TomlSection, key: string, value: string): string;
export declare function removeSetting(config: string, section: TomlSection, key: string): string;
export declare function replaceOrInsertRootSetting(config: string, key: string, value: string): string;
export declare function appendBlock(config: string, block: string): string;
export declare function escapeRegExp(value: string): string;
