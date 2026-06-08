export declare function exists(path: string): Promise<boolean>;
export declare function isNodeErrorWithCode(error: unknown): error is NodeJS.ErrnoException;
export declare function isRecord(value: unknown): value is Record<string, unknown>;
