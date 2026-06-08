import { z } from "zod";
/**
 * Project Brain config — OpenCode per-team/project knowledge base.
 * Disabled by default. Tools and hooks wire in separately.
 */
export declare const ProjectBrainConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    server_url: z.ZodOptional<z.ZodString>;
    token_env: z.ZodDefault<z.ZodString>;
    tools: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    context_retrieval: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        max_results: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    learning_capture: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    local_vault: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        cache_dir: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    request_timeout_ms: z.ZodDefault<z.ZodNumber>;
    max_results: z.ZodDefault<z.ZodNumber>;
    max_context_chars: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type ProjectBrainConfig = z.infer<typeof ProjectBrainConfigSchema>;
