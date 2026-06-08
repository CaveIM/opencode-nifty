export interface BrainAuth {
    token: string;
    envName: string;
}
/**
 * Resolve the Project Brain token from an environment variable.
 * Accepts an optional injected env map for testability; defaults to process.env.
 */
export declare function resolveToken(envName: string, env?: Record<string, string | undefined>): BrainAuth;
/**
 * Redact a token for safe display in errors and logs.
 * Shows first 4 + last 4 characters with mask between.
 */
export declare function redactToken(token: string): string;
