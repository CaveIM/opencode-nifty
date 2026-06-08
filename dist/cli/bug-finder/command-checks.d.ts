import type { BugFinderCheck, BugFinderFinding, BugFinderInventory, BugFinderRunCommand } from "./types";
type CommandCheckResult = {
    check: BugFinderCheck;
    finding?: BugFinderFinding;
};
export declare const runCommandChecks: (directory: string, inventory: BugFinderInventory, runCommand: BugFinderRunCommand, includeP2: boolean) => Promise<CommandCheckResult[]>;
export {};
