export declare function applyModelResolution(input: {
    uiSelectedModel?: string;
    userModel?: string;
    requirement?: {
        fallbackChain?: {
            providers: string[];
            model: string;
            variant?: string;
        }[];
    };
    availableModels: Set<string>;
    systemDefaultModel?: string;
}): import("@cave-meister/model-core").PipelineModelResolutionResult | undefined;
export declare function getFirstFallbackModel(requirement?: {
    fallbackChain?: {
        providers: string[];
        model: string;
        variant?: string;
    }[];
}): {
    model: string;
    provenance: "provider-fallback";
    variant: string | undefined;
} | undefined;
