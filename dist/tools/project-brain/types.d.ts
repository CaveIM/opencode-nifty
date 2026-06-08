export type ProjectBrainSearchToolArgs = {
    team_id: string;
    project_id: string;
    query: string;
    max_results?: number;
};
export type ProjectBrainOpenToolArgs = {
    team_id: string;
    project_id: string;
    source_id: string;
};
export type ProjectBrainReflectToolArgs = {
    team_id: string;
    project_id: string;
    subject: string;
    observation: string;
    evidence: string[];
    proposal: string;
    source_session_id?: string;
};
export type ProjectBrainStatusToolArgs = {
    team_id: string;
    project_id: string;
};
