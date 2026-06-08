import type { FallbackState, FallbackResult } from "./types";
import type { RuntimeFallbackConfig } from "../../config";
export declare function stringifyRuntimeModel(model: unknown): string | undefined;
export declare function stringifyRuntimeModelWithVariant(model: unknown, variant: unknown): string | undefined;
export declare function areRuntimeModelsEquivalent(candidate: string | undefined, current: string | undefined): boolean;
export declare function createFallbackState(originalModel: unknown): FallbackState;
export declare function isModelInCooldown(model: string, state: FallbackState, cooldownSeconds: number): boolean;
export declare function findNextAvailableFallback(state: FallbackState, fallbackModels: string[], cooldownSeconds: number): string | undefined;
export declare function prepareFallback(sessionID: string, state: FallbackState, fallbackModels: string[], config: Required<RuntimeFallbackConfig>): FallbackResult;
