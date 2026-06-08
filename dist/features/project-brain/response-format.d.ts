import type { ProjectBrainContextItem, ProjectBrainDocument, ProjectBrainReflectionResult, ProjectBrainSearchResult, ProjectBrainStatus } from "./types";
export declare function formatContextItem(entry: ProjectBrainContextItem): string;
export declare function formatSearchResult(result: ProjectBrainSearchResult): string;
export declare function formatDocument(document: ProjectBrainDocument): string;
export declare function formatReflectionResult(result: ProjectBrainReflectionResult): string;
export declare function formatStatus(status: ProjectBrainStatus): string;
export { formatContextItem as formatEntry, formatSearchResult as formatQueryResult };
