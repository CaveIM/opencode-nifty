import type { BuiltinSkill } from "../builtin-skills/types";
export type OpenCodeSkillMarkdown = {
    readonly name: string;
    readonly description: string;
    readonly markdown: string;
};
export declare function createOpenCodeSkillMarkdown(skill: BuiltinSkill): OpenCodeSkillMarkdown;
