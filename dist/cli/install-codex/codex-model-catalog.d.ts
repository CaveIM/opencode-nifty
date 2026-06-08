export type CodexReasoningProfile = {
    readonly model: string;
    readonly modelContextWindow: number;
    readonly modelReasoningEffort: string;
    readonly planModeReasoningEffort: string;
};
export type CodexReasoningProfileMatch = Partial<CodexReasoningProfile>;
export type CodexModelCatalog = {
    readonly current: CodexReasoningProfile;
    readonly managedProfiles: readonly CodexReasoningProfileMatch[];
};
export declare function readCodexModelCatalog(codexPackageRoot: string): Promise<CodexModelCatalog>;
export declare function readCodexReasoningProfile(codexPackageRoot: string): Promise<CodexReasoningProfile>;
