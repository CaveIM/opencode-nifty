import type { GetModelCapabilitiesInput, ModelCapabilities } from "@cave-meister/model-core";
export declare function getBundledModelCapabilitiesSnapshotForRuntime(): import("@cave-meister/model-core").ModelCapabilitiesSnapshot;
export declare function getBundledModelCapabilitiesSnapshotForShared(): ReturnType<typeof getBundledModelCapabilitiesSnapshotForRuntime>;
export { getBundledModelCapabilitiesSnapshotForShared as getBundledModelCapabilitiesSnapshot };
export declare function getModelCapabilities(input: GetModelCapabilitiesInput): ModelCapabilities;
export type { GetModelCapabilitiesInput, ModelCapabilities, ModelCapabilitiesDiagnostics, ModelCapabilitiesSnapshot, ModelCapabilitiesSnapshotEntry, } from "@cave-meister/model-core";
