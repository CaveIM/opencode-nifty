type AgentToolRestrictionsOptions = {
    includeTeamToolDenylist?: boolean;
};
export declare function getAgentToolRestrictions(agentName: string, options?: AgentToolRestrictionsOptions): Record<string, boolean>;
export declare function hasAgentToolRestrictions(agentName: string): boolean;
export {};
