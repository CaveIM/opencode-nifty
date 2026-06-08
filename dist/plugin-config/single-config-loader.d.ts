import { type OhMyOpenCodeConfig } from "../config";
export declare function loadExplicitGitMasterOverrides(configPath: string): Record<string, unknown> | undefined;
export declare function parseConfigPartially(rawConfig: Record<string, unknown>): Partial<OhMyOpenCodeConfig> | null;
export declare function loadConfigFromPath(configPath: string, _ctx: unknown): Partial<OhMyOpenCodeConfig> | null;
