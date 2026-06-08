import { getNextFallback, hasMoreFallbacks, isRetryableModelError, selectFallbackProviderWithCache, shouldRetryError } from "@cave-meister/model-core";
import type { ErrorInfo } from "@cave-meister/model-core";
export type { ErrorInfo };
export { isRetryableModelError, shouldRetryError, getNextFallback, hasMoreFallbacks, selectFallbackProviderWithCache, };
export declare function selectFallbackProvider(providers: string[], preferredProviderID?: string): string;
