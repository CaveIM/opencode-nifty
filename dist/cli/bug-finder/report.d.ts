import type { BugFinderFailOn, BugFinderReport, BugFinderRunCommand, BugFinderSummary } from "./types";
export declare const createReport: (directory: string, runCommand: BugFinderRunCommand, includeP2: boolean) => Promise<BugFinderReport>;
export declare const shouldFail: (summary: BugFinderSummary, failOn: BugFinderFailOn) => boolean;
