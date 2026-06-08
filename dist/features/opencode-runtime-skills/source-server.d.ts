import type { RuntimeSkillSourceEntry } from "./runtime-skill-config";
export type RuntimeSkillSourceServer = {
    readonly url: string;
    readonly stop: () => void;
};
export declare function createRuntimeSkillSourceServer(options: {
    readonly skills: readonly RuntimeSkillSourceEntry[];
}): RuntimeSkillSourceServer;
