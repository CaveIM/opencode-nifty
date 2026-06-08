export declare const FALLBACK_AGENT = "general";
export declare function isAgentNotFoundError(error: unknown): boolean;
export declare function buildFallbackBody(originalBody: Record<string, unknown>, fallbackAgent: string, options?: {
    includeTeamToolDenylist?: boolean;
}): Record<string, unknown>;
