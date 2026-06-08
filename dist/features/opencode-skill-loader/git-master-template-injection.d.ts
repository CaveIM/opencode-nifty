import { type GitMasterConfig } from "../../config/schema";
import { type ShellType } from "../../shared/shell-env";
/**
 * Parse a bash-format env prefix string ("VAR=value VAR2=value2") into a Record.
 * Only handles simple KEY=VALUE pairs (no quoting needed since assertValidGitEnvPrefix
 * already validates the format is shell-safe alphanumeric assignments).
 */
export declare function parseBashEnvPrefix(prefix: string): Record<string, string>;
/**
 * Build the shell-aware command prefix for git commands.
 * Uses the shared shell detection and env prefix builder to emit correct syntax
 * for PowerShell ($env:VAR='value';), cmd (set VAR="value" &&),
 * csh (setenv VAR value;), or unix (VAR=value).
 *
 * For unix shells, we use the inline VAR=value prefix style (not export) to match
 * the original behavior where the env var applies only to the immediately following command.
 * For csh/tcsh, we use setenv syntax since csh does not support inline VAR=value.
 */
export declare function buildShellAwareGitPrefix(bashPrefix: string, shellType?: ShellType): string;
export declare function injectGitMasterConfig(template: string, config?: GitMasterConfig): string;
