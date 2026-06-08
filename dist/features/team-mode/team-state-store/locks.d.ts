import { open, rename, rm } from "node:fs/promises";
type LockOptions = {
    staleAfterMs?: number;
    ownerTag?: string;
};
type AtomicWriteDeps = {
    open?: typeof open;
    rename?: typeof rename;
    rm?: typeof rm;
};
export declare function withLock<T>(lockPath: string, fn: () => Promise<T>, opts?: LockOptions): Promise<T>;
export declare function detectStaleLock(lockPath: string, staleAfterMs: number): Promise<boolean>;
export declare function reapStaleLock(lockPath: string): Promise<void>;
export declare function atomicWrite(filePath: string, content: string | Buffer, deps?: AtomicWriteDeps): Promise<void>;
export {};
