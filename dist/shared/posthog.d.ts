import os from "os";
import { getPostHogActivityCaptureState } from "./posthog-activity-state";
type OsProvider = Pick<typeof os, "arch" | "cpus" | "hostname" | "platform" | "release" | "totalmem" | "type">;
/** @internal test-only */
export declare function __setActivityStateProviderForTesting(provider: typeof getPostHogActivityCaptureState): void;
/** @internal test-only */
export declare function __resetActivityStateProviderForTesting(): void;
/** @internal test-only */
export declare function __setOsProviderForTesting(provider: OsProvider): void;
/** @internal test-only */
export declare function __resetOsProviderForTesting(): void;
type PostHogActivityReason = "run_started";
type PostHogClient = {
    trackActive: (distinctId: string, reason: PostHogActivityReason) => void;
    shutdown: () => Promise<void>;
};
export declare function getPostHogDistinctId(): string;
export declare function createCliPostHog(): PostHogClient;
export declare function createPluginPostHog(): PostHogClient;
export {};
