export interface ErrorAutoFilerDeps {
    createBugTool: (args: {
        title: string;
        description: string;
        error_message?: string;
        labels?: string[];
    }) => Promise<{
        success: boolean;
        github_issue?: {
            number: number;
        };
    }>;
    config: {
        fileBugs: boolean;
    };
    directory: string;
}
export interface ErrorAutoFilerHook {
    event: (input: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    dispose?: () => void;
}
export declare function createErrorAutoFilerHook(deps: ErrorAutoFilerDeps): ErrorAutoFilerHook;
