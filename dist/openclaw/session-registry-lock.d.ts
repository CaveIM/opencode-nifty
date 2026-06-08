export declare function withRegistryLockOrWait<T>(onLocked: () => T, onLockUnavailable: () => T): T;
export declare function withRegistryLock(onLocked: () => void, onLockUnavailable: () => void): void;
