import type { ToolExecutionResult } from "./tools.js";
export declare function missingDependencyResult<TDetails extends object>(error: unknown, details: TDetails): ToolExecutionResult | null;
