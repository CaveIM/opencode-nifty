import { log } from "../../shared/logger";
import type { ProjectScope } from "./scope-detector";
export interface NiftyIndexerDeps {
    fetchNiftyTasks: (projectId: string, accessToken: string) => Promise<NiftyTask[]>;
    ingestToBrain: (source: BrainIngestSource) => Promise<{
        source_id: string;
    } | null>;
    getAccessToken: () => Promise<string | null>;
    log: typeof log;
}
export interface NiftyTask {
    id: string;
    name: string;
    description?: string;
    status: string;
    assignees?: string[];
    due_date?: string;
    created_at: string;
    updated_at: string;
    comments?: NiftyComment[];
    subtasks?: NiftySubtask[];
    labels?: string[];
    priority?: string;
}
export interface NiftyComment {
    id: string;
    content: string;
    author: string;
    created_at: string;
}
export interface NiftySubtask {
    id: string;
    name: string;
    completed: boolean;
}
export interface BrainIngestSource {
    source_uri: string;
    source_type: string;
    title: string;
    content: string;
    metadata: Record<string, unknown>;
    chunks: Array<{
        content: string;
        metadata: Record<string, unknown>;
    }>;
}
export interface NiftyIndexerResult {
    indexed: number;
    skipped: number;
    errors: string[];
}
export declare function createNiftyIndexer(deps?: Partial<NiftyIndexerDeps>): {
    indexProject: (scope: ProjectScope) => Promise<NiftyIndexerResult>;
};
