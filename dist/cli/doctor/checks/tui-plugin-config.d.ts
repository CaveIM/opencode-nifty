import type { CheckResult } from "../types";
interface ServerPluginInfo {
    registered: boolean;
    configPath: string | null;
    packageExportsTui: boolean | null;
}
interface TuiPluginInfo {
    registered: boolean;
    configPath: string | null;
    exists: boolean;
    hasNamedTuiEntry: boolean;
}
export declare function detectServerPluginRegistration(): ServerPluginInfo;
export declare function detectTuiPluginRegistration(): TuiPluginInfo;
export declare function checkTuiPluginConfig(): Promise<CheckResult>;
export {};
