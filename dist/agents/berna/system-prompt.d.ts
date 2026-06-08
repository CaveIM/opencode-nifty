export type BernaPromptSource = "default" | "gpt" | "gemini";
export declare const BERNA_PERMISSION: {
    edit: "allow";
    bash: "allow";
    webfetch: "allow";
    question: "allow";
};
export declare const BERNA_SYSTEM_PROMPT: string;
export declare function getBernaPromptSource(model?: string): BernaPromptSource;
export declare function getBernaPrompt(model?: string, disabledTools?: readonly string[]): string;
