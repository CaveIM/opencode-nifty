import type { DependencyInfo } from "../types";
export declare function checkAstGrepCli(): Promise<DependencyInfo>;
export declare function checkAstGrepNapi(): Promise<DependencyInfo>;
export declare function findCommentCheckerPackageBinary(baseDirOverride?: string): string | null;
export declare function checkCommentChecker(): Promise<DependencyInfo>;
