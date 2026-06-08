type ParentTaskSource = "env" | "file" | "default" | "none";
export type ResolvedParentTask = {
    readonly taskId: string;
    readonly source: ParentTaskSource;
};
export declare function resolveParentTask(directory?: string): ResolvedParentTask;
export {};
