import type { SkillInfo } from "./types";
import type { CommandInfo } from "../slashcommand/types";
interface CombinedDescriptionOptions {
    includeSkills?: boolean;
}
export declare function formatCombinedDescription(skills?: SkillInfo[], commands?: CommandInfo[], options?: CombinedDescriptionOptions): string;
export {};
