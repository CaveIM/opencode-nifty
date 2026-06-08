import type { SessionMapping } from "./session-registry-types";
export declare function ensureRegistryDir(): void;
export declare function readAllMappingsUnsafe(): SessionMapping[];
export declare function rewriteRegistryUnsafe(mappings: readonly SessionMapping[]): void;
