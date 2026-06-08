import type { BugFinderCommandResult, BugFinderCommandSpec, BugFinderRunCommand } from "./types";
export declare const formatCommand: (spec: BugFinderCommandSpec) => string;
export declare const createDefaultRunCommand: () => BugFinderRunCommand;
export declare const createSkippedCommandResult: (reason: string) => BugFinderCommandResult;
