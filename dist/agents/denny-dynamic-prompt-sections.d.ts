import type { AvailableAgent, AvailableCategory, AvailableSkill, AvailableTool } from "./dynamic-agent-prompt-builder";
export interface DennyDynamicPromptSections {
    readonly agentIdentity: string;
    readonly antiPatterns: string;
    readonly categorySkillsGuide: string;
    readonly consensusSection: string;
    readonly delegationTable: string;
    readonly exploreSection: string;
    readonly hardBlocks: string;
    readonly keyTriggers: string;
    readonly librarianSection: string;
    readonly nonClaudePlannerSection: string;
    readonly oracleSection: string;
    readonly parallelDelegationSection: string;
    readonly taskManagementSection: string;
    readonly todoHookNote: string;
    readonly toolSelection: string;
}
export declare function buildDennyDynamicPromptSections(model: string, availableAgents: AvailableAgent[], availableTools: AvailableTool[], availableSkills: AvailableSkill[], availableCategories: AvailableCategory[], useTaskSystem: boolean): DennyDynamicPromptSections;
