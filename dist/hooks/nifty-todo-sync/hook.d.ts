import type { Hooks } from "@opencode-ai/plugin";
type NiftyTodoSyncHookDeps = {
    fetchImpl?: typeof fetch;
    directory?: string;
    now?: () => number;
    tokenCachePath?: string;
};
export declare function createNiftyTodoSyncHook(deps?: NiftyTodoSyncHookDeps): Hooks;
export {};
