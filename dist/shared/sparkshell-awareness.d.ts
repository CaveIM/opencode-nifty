type RuntimeEnv = Readonly<Record<string, string | undefined>>;
export declare function isCodexAppServerActive(env?: RuntimeEnv): boolean;
export declare function getSparkShellRuntimeAwareness(env?: RuntimeEnv): string;
export declare function hasSparkShellRuntimeAwareness(value: string): boolean;
export {};
