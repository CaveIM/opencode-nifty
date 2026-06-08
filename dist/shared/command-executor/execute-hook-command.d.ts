export interface CommandResult {
    exitCode: number;
    stdout?: string;
    stderr?: string;
}
export interface ExecuteHookOptions {
    forceZsh?: boolean;
    zshPath?: string;
    /** Timeout in milliseconds. Process is killed after this. Default: 30000 */
    timeoutMs?: number;
    /** Grace period before force-killing and resolving timed-out commands. Default: 5000 */
    killGraceMs?: number;
    /** When provided, scrub process.env to only include these vars plus HOME/PATH/etc. Used for plugin-sourced hooks. */
    allowedEnvVars?: string[];
}
export declare function executeHookCommand(command: string, stdin: string, cwd: string, options?: ExecuteHookOptions): Promise<CommandResult>;
