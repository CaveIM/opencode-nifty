import { z } from "zod";
export declare const CategoryConfigSchema: z.ZodObject<{
    description: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
        model: z.ZodString;
        variant: z.ZodOptional<z.ZodString>;
        reasoningEffort: z.ZodOptional<z.ZodEnum<{
            max: "max";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            low: "low";
            none: "none";
            minimal: "minimal";
        }>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        top_p: z.ZodOptional<z.ZodNumber>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        thinking: z.ZodOptional<z.ZodObject<{
            type: z.ZodEnum<{
                enabled: "enabled";
                disabled: "disabled";
            }>;
            budgetTokens: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        model: z.ZodString;
        variant: z.ZodOptional<z.ZodString>;
        reasoningEffort: z.ZodOptional<z.ZodEnum<{
            max: "max";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            low: "low";
            none: "none";
            minimal: "minimal";
        }>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        top_p: z.ZodOptional<z.ZodNumber>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        thinking: z.ZodOptional<z.ZodObject<{
            type: z.ZodEnum<{
                enabled: "enabled";
                disabled: "disabled";
            }>;
            budgetTokens: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>]>>]>>;
    variant: z.ZodOptional<z.ZodString>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            enabled: "enabled";
            disabled: "disabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        max: "max";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        low: "low";
        none: "none";
        minimal: "minimal";
    }>>;
    textVerbosity: z.ZodOptional<z.ZodEnum<{
        medium: "medium";
        high: "high";
        low: "low";
    }>>;
    tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    prompt_append: z.ZodOptional<z.ZodString>;
    max_prompt_tokens: z.ZodOptional<z.ZodNumber>;
    is_unstable_agent: z.ZodOptional<z.ZodBoolean>;
    disable: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const BuiltinCategoryNameSchema: z.ZodEnum<{
    "visual-engineering": "visual-engineering";
    ultrabrain: "ultrabrain";
    deep: "deep";
    artistry: "artistry";
    quick: "quick";
    "unspecified-low": "unspecified-low";
    "unspecified-high": "unspecified-high";
    writing: "writing";
}>;
export declare const CategoriesConfigSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
    description: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
        model: z.ZodString;
        variant: z.ZodOptional<z.ZodString>;
        reasoningEffort: z.ZodOptional<z.ZodEnum<{
            max: "max";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            low: "low";
            none: "none";
            minimal: "minimal";
        }>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        top_p: z.ZodOptional<z.ZodNumber>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        thinking: z.ZodOptional<z.ZodObject<{
            type: z.ZodEnum<{
                enabled: "enabled";
                disabled: "disabled";
            }>;
            budgetTokens: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        model: z.ZodString;
        variant: z.ZodOptional<z.ZodString>;
        reasoningEffort: z.ZodOptional<z.ZodEnum<{
            max: "max";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            low: "low";
            none: "none";
            minimal: "minimal";
        }>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        top_p: z.ZodOptional<z.ZodNumber>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        thinking: z.ZodOptional<z.ZodObject<{
            type: z.ZodEnum<{
                enabled: "enabled";
                disabled: "disabled";
            }>;
            budgetTokens: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>]>>]>>;
    variant: z.ZodOptional<z.ZodString>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            enabled: "enabled";
            disabled: "disabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        max: "max";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        low: "low";
        none: "none";
        minimal: "minimal";
    }>>;
    textVerbosity: z.ZodOptional<z.ZodEnum<{
        medium: "medium";
        high: "high";
        low: "low";
    }>>;
    tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    prompt_append: z.ZodOptional<z.ZodString>;
    max_prompt_tokens: z.ZodOptional<z.ZodNumber>;
    is_unstable_agent: z.ZodOptional<z.ZodBoolean>;
    disable: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>>;
export type CategoryConfig = z.infer<typeof CategoryConfigSchema>;
export type CategoriesConfig = z.infer<typeof CategoriesConfigSchema>;
export type BuiltinCategoryName = z.infer<typeof BuiltinCategoryNameSchema>;
