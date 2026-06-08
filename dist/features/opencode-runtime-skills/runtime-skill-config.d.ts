import type { OhMyOpenCodeConfig } from "../../config";
import { type OpenCodeSkillMarkdown } from "./skill-markdown";
export type RuntimeSkillSourceEntry = OpenCodeSkillMarkdown;
export type OpenCodeSkillsHostConfig = {
    readonly paths?: readonly string[];
    readonly urls?: readonly string[];
    readonly [key: string]: unknown;
};
export type OpenCodeSkillHostConfig = Record<string, unknown> & {
    skills?: OpenCodeSkillsHostConfig;
};
export declare function selectRuntimeSecuritySkills(pluginConfig?: Pick<OhMyOpenCodeConfig, "disabled_skills">): RuntimeSkillSourceEntry[];
export declare function applyRuntimeSkillSourceConfig(params: {
    readonly config: OpenCodeSkillHostConfig;
    readonly pluginConfig: Pick<OhMyOpenCodeConfig, "disabled_skills">;
    readonly sourceUrl: string;
}): void;
