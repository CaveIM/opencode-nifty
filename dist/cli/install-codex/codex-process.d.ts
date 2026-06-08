import type { RunCommand } from "./types";
export type RunCommandInvocation = {
    readonly command: string;
    readonly args: readonly string[];
};
export declare function resolveRunCommandInvocation(command: string, args: readonly string[], platform?: NodeJS.Platform): RunCommandInvocation;
export declare const defaultRunCommand: RunCommand;
