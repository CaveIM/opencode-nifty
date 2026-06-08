import type { DoctorIssue } from "../types";
interface BugFilingDeps {
    createBugTool: (args: {
        title: string;
        description: string;
        error_message?: string;
        labels?: string[];
    }) => Promise<any>;
}
interface BugFilingResult {
    filed: boolean;
    githubIssue?: {
        number: number;
        url: string;
    };
    niftyTask?: {
        id: string;
        url: string;
    };
    error?: string;
}
export declare function checkAndFileBug(options: {
    directory: string;
    doctorIssues: DoctorIssue[];
    createBugTool: BugFilingDeps["createBugTool"];
}): Promise<BugFilingResult>;
declare function buildBugDescription(issues: DoctorIssue[]): string;
export { buildBugDescription };
export type { BugFilingResult, BugFilingDeps };
