export type ProjectBrainSourceKind = "policy" | "rule" | "doc" | "task" | "skill" | "decision" | "reflection" | "memory" | "unknown";
export type ProjectBrainProposalStatus = "received" | "queued" | "duplicate";
export type ProjectBrainHealthStatus = "ok" | "degraded" | "unreachable";
export interface ProjectBrainScope {
    team_id: string;
    project_id: string;
    repo?: string;
    workspace_path?: string;
    session_id?: string;
}
export interface ProjectBrainContextItem {
    id: string;
    title?: string;
    content: string;
    source: ProjectBrainSourceKind;
    score?: number;
    citation?: string;
    updated_at?: string;
    metadata?: Record<string, unknown>;
}
export interface ProjectBrainSearchRequest {
    scope: ProjectBrainScope;
    query: string;
    max_results?: number;
}
export interface ProjectBrainSearchResult {
    items: ProjectBrainContextItem[];
    total: number;
    audit_id?: string;
}
export interface ProjectBrainOpenRequest {
    scope: ProjectBrainScope;
    source_id: string;
}
export interface ProjectBrainDocument {
    id: string;
    title?: string;
    content: string;
    source: ProjectBrainSourceKind;
    version?: string;
    citation?: string;
    updated_at?: string;
    metadata?: Record<string, unknown>;
}
export interface ProjectBrainReflectionProposal {
    scope: ProjectBrainScope;
    subject: string;
    observation: string;
    evidence: string[];
    proposal: string;
    source_session_id?: string;
}
export interface ProjectBrainReflectionResult {
    proposal_id: string;
    status: ProjectBrainProposalStatus;
    audit_id?: string;
}
export interface ProjectBrainStatusRequest {
    scope: ProjectBrainScope;
}
export interface ProjectBrainStatus {
    ok: boolean;
    status: ProjectBrainHealthStatus;
    server_url: string;
    team_id: string;
    project_id: string;
    detail?: string;
}
export declare function validateScope(scope: ProjectBrainScope): void;
