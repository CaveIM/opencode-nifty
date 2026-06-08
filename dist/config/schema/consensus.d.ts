import { z } from "zod";
/**
 * Default voter lineages. Spans frontier closed-source labs + open-weights to maximize blind-spot coverage
 * across model families. The synthesizer is the calling agent itself (no separate synthesizer agent),
 * so voter lineages should typically differ from the calling model's lineage.
 */
export declare const DEFAULT_VOTER_LINEAGES: readonly ["claude-opus", "gpt", "gemini-flash", "kimi"];
declare const PreQuestionGateConfigSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    voter_count: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
declare const PostTestGateConfigSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    command_patterns: z.ZodOptional<z.ZodArray<z.ZodString>>;
    voter_count: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const ConsensusConfigSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    default_voter_count: z.ZodOptional<z.ZodNumber>;
    default_voter_lineages: z.ZodOptional<z.ZodArray<z.ZodString>>;
    voter_timeout_ms: z.ZodOptional<z.ZodNumber>;
    voter_reasoning_effort: z.ZodOptional<z.ZodEnum<{
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        low: "low";
        none: "none";
        minimal: "minimal";
    }>>;
    pre_question_gate: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        voter_count: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    post_test_gate: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        command_patterns: z.ZodOptional<z.ZodArray<z.ZodString>>;
        voter_count: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ConsensusConfig = z.infer<typeof ConsensusConfigSchema>;
export type PreQuestionGateConfig = z.infer<typeof PreQuestionGateConfigSchema>;
export type PostTestGateConfig = z.infer<typeof PostTestGateConfigSchema>;
export {};
