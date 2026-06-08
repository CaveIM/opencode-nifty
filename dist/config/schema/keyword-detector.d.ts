import { z } from "zod";
export declare const KeywordTypeSchema: z.ZodEnum<{
    search: "search";
    ultrawork: "ultrawork";
    hyperplan: "hyperplan";
    analyze: "analyze";
    team: "team";
    "hyperplan-ultrawork": "hyperplan-ultrawork";
}>;
export type KeywordType = z.infer<typeof KeywordTypeSchema>;
export declare const KeywordDetectorConfigSchema: z.ZodObject<{
    enabled_expansions: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        search: "search";
        ultrawork: "ultrawork";
        hyperplan: "hyperplan";
        analyze: "analyze";
        team: "team";
        "hyperplan-ultrawork": "hyperplan-ultrawork";
    }>>>;
    disabled_keywords: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        search: "search";
        ultrawork: "ultrawork";
        hyperplan: "hyperplan";
        analyze: "analyze";
        team: "team";
        "hyperplan-ultrawork": "hyperplan-ultrawork";
    }>>>;
}, z.core.$strip>;
export type KeywordDetectorConfig = z.infer<typeof KeywordDetectorConfigSchema>;
