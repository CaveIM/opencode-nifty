import type { GitMasterConfig, BrowserAutomationProvider } from "../../config/schema";
import type { NativeSkillEntry } from "../skill/native-skills";
import type { DelegateTaskToolOptions } from "./types";
type ResolveSkillContentOptions = {
    gitMasterConfig?: GitMasterConfig;
    browserProvider?: BrowserAutomationProvider;
    disabledSkills?: Set<string>;
    teamModeEnabled?: boolean;
    directory?: string;
    targetAgent?: string;
    nativeSkills?: DelegateTaskToolOptions["nativeSkills"];
    nativeSkillEntries?: NativeSkillEntry[];
};
export declare function resolveSkillContent(skills: string[], options: ResolveSkillContentOptions): Promise<{
    content: string | undefined;
    contents: string[];
    error: string | null;
}>;
export {};
