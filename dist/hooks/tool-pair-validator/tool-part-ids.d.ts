import type { TransformPart } from "./types";
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function getToolUseID(part: TransformPart): string | null;
export declare function getToolResultID(part: TransformPart): string | null;
export declare function extractUniqueToolUseIDs(parts: TransformPart[]): string[];
export declare function extractToolResultIDs(parts: TransformPart[]): Set<string>;
